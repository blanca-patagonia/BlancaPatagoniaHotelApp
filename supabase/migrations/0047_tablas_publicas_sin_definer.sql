-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0047 — `tablas_publicas()` sin `security definer`
--
-- Corrige la 0046, que quedó **imposible de llamar por su único consumidor**.
--
-- ── El error ────────────────────────────────────────────────────────────────
--
-- La 0046 puso la guarda adentro de la función:
--
--     if rol_actual() is distinct from 'admin' then raise exception … end if;
--
-- El único que la llama es la auditoría RLS (`tests/rls-por-rol.test.ts`), y lo
-- hace con **`service_role`**. Para `service_role` no hay sesión de Auth:
-- `auth.uid()` es nulo, y por lo tanto `rol_actual()` devuelve `null`. La guarda
-- rechazaba con «Solo administración puede listar las tablas del esquema» al
-- cliente que precisamente tiene todos los permisos.
--
-- Y no se arregla mirando `current_user`: en una función `security definer`,
-- `current_user` es el **dueño** de la función, no quien la llama. Es la misma
-- trampa que documenta el ADR 0016 para `cotizar_estadia`, vista desde el otro
-- lado — ahí el peligro es que la guarda quede siempre en verdadero; acá quedó
-- siempre en falso.
--
-- ── Por qué el `security definer` sobraba ───────────────────────────────────
--
-- Verificado contra la base local:
--
--     set role authenticated;
--     select count(*) from pg_tables where schemaname = 'public';   -- 40
--
-- `pg_catalog` concede `select` a `public` sobre sus vistas, y `pg_tables` **no**
-- filtra filas por privilegio. O sea: cualquier rol lee esa vista sin ayuda. El
-- `security definer` de la 0046 resolvía un problema que no existía y a cambio
-- introducía el que sí.
--
-- ── El diseño que queda ─────────────────────────────────────────────────────
--
-- `security invoker` (la omisión) y `execute` concedido **solo a `service_role`**.
-- Así el `grant` **es** la guarda: no hay lógica de autorización adentro que pueda
-- estar mal escrita, y Postgres responde «permission denied for function» a
-- `anon` y a `authenticated` sin que la función llegue a ejecutarse.
--
-- Menos superficie que la 0046 en las dos direcciones: no hay escalada de
-- privilegio posible porque no hay privilegio prestado, y el conjunto de quien
-- puede llamarla es más chico (antes: `authenticated` + `service_role`; ahora:
-- solo `service_role`). El único consumidor es un test de auditoría; no hace
-- falta que un navegador pueda llamarla nunca.
--
-- `search_path` fijo se conserva: no protege de nada acá, pero evita que un
-- esquema `public` sombreado cambie qué vista se lee, y cuesta una línea.
-- ─────────────────────────────────────────────────────────────────────────────

-- `drop` y no `create or replace`: la 0046 la dejó en `plpgsql` y con `security
-- definer`, y `create or replace` **no puede cambiar** el modo de seguridad ni el
-- lenguaje de una función existente. Sin el `drop` la corrección no se aplicaría.
drop function if exists tablas_publicas();

create function tablas_publicas()
returns table (tabla text)
language sql
stable
set search_path = public, pg_catalog
as $$
  select tablename::text
    from pg_tables
   where schemaname = 'public'
   order by tablename;
$$;

comment on function tablas_publicas() is
  'Nombres de las tablas del esquema public. Existe para que la auditoría RLS detecte una tabla nueva sin declarar en su matriz. `security invoker` a propósito (ver 0047): el grant a service_role es la única autorización, no hay guarda de rol adentro. Devuelve nombres, nunca contenido.';

-- El `grant` como guarda. Se revoca a `public` primero porque `execute` sobre una
-- función nueva se concede a todos por omisión.
revoke execute on function tablas_publicas() from public;
grant execute on function tablas_publicas() to service_role;
