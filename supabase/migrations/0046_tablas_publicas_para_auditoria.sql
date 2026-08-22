-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0046 — Listado de tablas, para que la auditoría RLS no se quede vieja
--
-- ── Por qué hace falta una función para algo tan simple ──────────────────────
--
-- La auditoría de las políticas RLS (`tests/rls-por-rol.test.ts`) compara lo que
-- cada rol puede leer contra una matriz declarada. Esa matriz solo sirve si está
-- **completa**: una tabla nueva que nadie declare queda sin auditar, y el silencio
-- se confunde con un visto bueno.
--
-- Para detectarlo hay que preguntarle a la base qué tablas existen. Y no se puede
-- desde PostgREST: `information_schema` y `pg_catalog` no están expuestos, con buen
-- criterio. La primera versión del test caía en un respaldo que comparaba la matriz
-- contra sí misma —o sea, no podía fallar— y eso es peor que no tener el test.
--
-- ── Por qué es seguro exponerla ─────────────────────────────────────────────
--
-- Devuelve **solo los nombres** de las tablas del esquema `public`, y solo a
-- `admin` y a `service_role`. Los nombres de las tablas no son un secreto: están en
-- las migraciones, que están en el repositorio, y PostgREST ya los revela en su
-- documento OpenAPI a cualquiera que pueda consultarlo. Lo que sí es secreto es el
-- contenido, y esto no lo toca.
--
-- Es `security definer` porque `pg_tables` necesita permisos que `authenticated` no
-- tiene, con `search_path` fijo para que nadie pueda inducir a la función a leer
-- otro esquema.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function tablas_publicas()
returns table (tabla text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select tablename::text
    from pg_tables
   where schemaname = 'public'
   order by tablename;
$$;

comment on function tablas_publicas() is
  'Nombres de las tablas del esquema public. Existe para que la auditoría RLS detecte una tabla nueva sin declarar. Solo admin y service_role; devuelve nombres, nunca contenido.';

-- ── Quién puede llamarla ─────────────────────────────────────────────────────
-- Se revoca a `public` primero: por omisión, `execute` sobre una función nueva se
-- concede a todos, y una función `security definer` heredando ese permiso es
-- justamente el patrón que hay que evitar.
revoke execute on function tablas_publicas() from public;
grant execute on function tablas_publicas() to service_role;

-- A `authenticated` se le concede, pero la función se apoya en RLS de `perfiles`
-- para saber quién es: la guarda de rol va adentro, porque un `grant` no puede
-- distinguir un admin de una mucama.
grant execute on function tablas_publicas() to authenticated;

-- La guarda propiamente dicha. Se reescribe la función con la comprobación adentro
-- en lugar de dejarla al `grant`, que no alcanza.
create or replace function tablas_publicas()
returns table (tabla text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  -- `rol_actual()` devuelve null para `anon` y para un usuario sin rol asignado.
  if rol_actual() is distinct from 'admin' then
    raise exception 'Solo administración puede listar las tablas del esquema'
      using errcode = '42501';
  end if;

  return query
    select tablename::text
      from pg_tables
     where schemaname = 'public'
     order by tablename;
end;
$$;
