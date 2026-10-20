-- 0119 — `anon` sin EXECUTE sobre las funciones propias que no son del portal,
--        y sin los privilegios residuales sobre tablas y secuencias.
--
-- ── El hallazgo (2026-10-20) ────────────────────────────────────────────────
--
-- Comparando una base armada desde cero con las migraciones contra la base de
-- trabajo (`npm run esquema:comparar`) apareció que, en una base NUEVA —que es lo
-- que va a ser la de producción—, el rol `anon` puede ejecutar `crear_reserva`,
-- `fusionar_huespedes`, `aplicar_precio_reserva`, `editar_ficha_reserva`,
-- `registrar_acceso_huesped` (security DEFINER) y `privilegios_de_escritura`
-- (security DEFINER), entre otras.
--
-- Las migraciones de esas funciones hacen bien lo que la 0070 enseñó:
-- `revoke execute ... from public` + `grant ... to authenticated, service_role`.
-- No alcanza: los privilegios por omisión de la plataforma
-- (`pg_default_acl` de `postgres` para funciones: `anon=X`) le dan EXECUTE a
-- `anon` DIRECTAMENTE al crear la función, no a través de PUBLIC. El `revoke from
-- public` no lo toca, y el test `funciones-sin-public` —que mira PUBLIC— tampoco
-- lo ve. Es la misma trampa que la 0089 cerró para las tablas, del lado de las
-- funciones.
--
-- Exposición real hoy: baja. Las de escritura son `security invoker` y RLS no le
-- deja a `anon` leer ni escribir esas tablas. Pero `registrar_acceso_huesped` es
-- DEFINER: cualquiera con la clave publicable (que viaja en el navegador por
-- diseño) podía llenar `auditoria_accesos` de filas falsas, que es justamente el
-- registro que tiene que ser creíble. Y `privilegios_de_escritura` le mostraba a
-- cualquiera qué tablas acepta escribir cada rol.
--
-- ── Lo que SÍ tiene que poder ejecutar `anon` ────────────────────────────────
--   · `rol_actual()`, `puede_ver_canal()`: aparecen en políticas RLS, y Postgres
--     chequea el EXECUTE del rol que consulta al evaluar una policy.
--   · `temporada_en()`: la llama `cotizar_estadia_publica` en modo invoker.
--   · `cotizar_estadia_publica`, `disponibilidad_por_tipo`, `unidades_disponibles`:
--     las usa el portal público para cotizar y mostrar disponibilidad.
-- Las funciones de extensiones (`btree_gist`, `pg_trgm`) no se tocan.
--
-- ── Restos de la 0089 ────────────────────────────────────────────────────────
-- La 0089 sacó insert/update/delete y el `usage` de las secuencias. Quedaban:
-- TRUNCATE, REFERENCES, TRIGGER y MAINTAIN sobre tablas (TRUNCATE ignora RLS) y
-- SELECT/UPDATE sobre secuencias (`setval`). Hoy no hay camino por PostgREST para
-- usarlos; se cierran igual, por la misma razón que la 0089 cerró lo suyo.

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- Las de una extensión son de la extensión, no del proyecto.
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
      and p.proname not in (
        'rol_actual', 'puede_ver_canal', 'temporada_en',
        'cotizar_estadia_publica', 'disponibilidad_por_tipo', 'unidades_disponibles'
      )
  loop
    execute format('revoke execute on function %s from anon', f.firma);
  end loop;
end
$$;

-- Que la próxima función nazca sin EXECUTE para `anon`. Sin esto, el arreglo
-- duraría hasta el próximo `create function` (igual que en la 0089).
alter default privileges in schema public revoke execute on functions from anon;

revoke truncate, references, trigger, maintain on all tables in schema public from anon;
alter default privileges in schema public revoke truncate, references, trigger, maintain on tables from anon;

revoke select, update on all sequences in schema public from anon;
alter default privileges in schema public revoke select, update on sequences from anon;

-- Insumo del test de contrato `tests/base-de-datos/funciones-sin-public.test.ts`:
-- las funciones propias que `anon` puede ejecutar por CUALQUIER camino (grant
-- directo o PUBLIC), que es lo que de verdad importa.
create or replace function funciones_ejecutables_por_anon()
returns table (firma text, definer boolean)
language sql
stable
set search_path = public, pg_catalog
as $$
  select p.oid::regprocedure::text, p.prosecdef
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
    -- Una función de trigger no se puede llamar directamente («trigger functions
    -- can only be called as triggers»): mismo criterio que la 0070.
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
  order by 1
$$;

comment on function funciones_ejecutables_por_anon() is
  'Funciones propias que anon puede ejecutar, por grant directo o por PUBLIC (0119). Insumo del test de contrato.';

revoke execute on function funciones_ejecutables_por_anon() from public, anon;
grant execute on function funciones_ejecutables_por_anon() to service_role;
