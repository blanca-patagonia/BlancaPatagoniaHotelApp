-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0056 — La auditoría RLS también mira las vistas
--
-- ── El agujero, encontrado en la propia auditoría ───────────────────────────
--
-- `tablas_publicas()` (migraciones 0046 + 0047) lee `pg_tables`, que devuelve **solo
-- tablas**. Las vistas quedaban fuera, y con ellas toda la garantía que el test de
-- cobertura promete: agregar una vista nueva no hacía fallar nada.
--
-- Eso importa porque una vista **hereda el `grant select to anon` por omisión igual
-- que una tabla** (migración 0006), y además puede exponer datos de tablas que sí
-- están protegidas: es precisamente el camino por el que se filtra algo sin que ninguna
-- política se vea mal escrita.
--
-- Se descubrió al agregar `resumen_canal_mes` (0055) y notar que el test de cobertura
-- —que existe para gritar cuando aparece un objeto sin declarar— **no dijo nada**. Un
-- test que pasa por el motivo equivocado es peor que no tenerlo, que es lo mismo que ya
-- había pasado con los casos negativos sobre tablas vacías.
--
-- ── Por qué se conserva el nombre ───────────────────────────────────────────
--
-- «Tabla» acá quiere decir «objeto del esquema que se puede leer por PostgREST», que es
-- lo que la auditoría necesita enumerar. Renombrarla obligaría a tocar el test sin
-- ganar nada, y el comentario deja claro qué devuelve.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function tablas_publicas()
returns table (tabla text)
language sql
stable
set search_path = public, pg_catalog
as $$
  select tablename::text from pg_tables where schemaname = 'public'
  union
  -- Las vistas, que hasta la 0056 quedaban sin auditar.
  select viewname::text  from pg_views  where schemaname = 'public'
  order by 1;
$$;

comment on function tablas_publicas() is
  'Nombres de las tablas Y VISTAS del esquema public. Existe para que la auditoria RLS detecte un objeto nuevo sin declarar en su matriz. Las vistas se incluyen desde la 0056: heredan el grant a anon igual que una tabla y pueden exponer datos de tablas protegidas. `security invoker` a proposito (0047): el grant a service_role es la unica autorizacion.';

-- El `create or replace` conserva los permisos, pero se repiten por si la función se
-- recreara desde cero en un entorno nuevo.
revoke execute on function tablas_publicas() from public;
grant execute on function tablas_publicas() to service_role;
