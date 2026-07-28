-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0011 — Hardening de reservas (Fase 7)
-- 1) Token inadivinable para la URL pública de confirmación (evita enumerar por
--    el código de reserva, que es corto y predecible).
-- 2) Expiración de reservas pendientes sin seña (libera inventario retenido).
-- ─────────────────────────────────────────────────────────────────────────────

alter table reservas add column token uuid not null default gen_random_uuid();
create unique index reservas_token_idx on reservas (token);
comment on column reservas.token is
  'Token opaco para la URL pública de confirmación (no enumerable como el código).';

-- Cancela las reservas 'pendiente' sin seña aprobada con más de p_dias días de
-- antigüedad. El trigger de sincronización libera las estadías (inventario).
create or replace function expirar_reservas_pendientes(p_dias int default 5)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  with vencidas as (
    update reservas r
    set estado = 'cancelada'
    where r.estado = 'pendiente'
      and r.creada_en < now() - make_interval(days => p_dias)
      and not exists (
        select 1 from pagos p
        where p.reserva_id = r.id
          and p.tipo = 'senia'
          and p.estado = 'aprobado'
      )
    returning 1
  )
  select count(*) into v_count from vencidas;
  return v_count;
end;
$$;
comment on function expirar_reservas_pendientes is
  'Cancela reservas pendientes sin seña con más de p_dias días. Programar por cron (pg_cron / Edge Function).';

grant execute on function expirar_reservas_pendientes(int) to authenticated, service_role;
