-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0027 — Tareas programadas y límite de escrituras públicas (Fase 12)
--
-- 1) Las cinco funciones programadas del sistema dependían de que alguien
--    apretara un botón. Se programan con pg_cron.
-- 2) El asistente del portal escribe en `consultas_bot` a través del servidor:
--    sin límite, un script puede llenar la tabla. Se acota por IP y por minuto.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Tareas programadas ────────────────────────────────────────────────────
/*
  `pg_cron` viene incluido en Supabase (hosted y local). Si la extensión no está
  disponible, el bloque no rompe la migración: las funciones se siguen pudiendo
  disparar a mano desde el panel, que es como venían funcionando.
*/
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron no disponible: las tareas quedan en disparo manual.';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Reservas pendientes sin seña: liberan inventario retenido. 03:10 a diario.
    perform cron.schedule(
      'expirar-reservas-pendientes', '10 3 * * *',
      $cmd$ select expirar_reservas_pendientes(5); $cmd$);

    -- Comprobantes de proveedor pasados de fecha. 03:20 a diario.
    perform cron.schedule(
      'vencer-comprobantes-proveedor', '20 3 * * *',
      $cmd$ select vencer_comprobantes_proveedor(); $cmd$);

    -- Órdenes de mantenimiento preventivo que corresponden hoy. 06:00 a diario.
    perform cron.schedule(
      'generar-mantenimiento-preventivo', '0 6 * * *',
      $cmd$ select generar_mantenimiento_preventivo(); $cmd$);

    -- Contratos enviados cuya vigencia ya terminó. 03:30 a diario.
    perform cron.schedule(
      'vencer-contratos', '30 3 * * *',
      $cmd$ update contratos set estado = 'vencido'
            where estado = 'enviado'
              and vigencia_hasta is not null
              and vigencia_hasta < current_date; $cmd$);
  end if;
end;
$$;

comment on schema public is
  'Tareas programadas con pg_cron: expiración de reservas, vencimiento de comprobantes y contratos, y mantenimiento preventivo. El recordatorio de llegadas queda manual porque envía correos desde la aplicación.';

-- ── 2) Límite de escrituras públicas ─────────────────────────────────────────
-- El asistente registra las consultas que no supo responder. La inserción la
-- hace el servidor con `service_role`, así que `anon` no escribe directo; pero
-- nada impedía que un script llamara mil veces a la Server Action.
alter table consultas_bot add column ip inet;
create index on consultas_bot (ip, creado_en desc);

comment on column consultas_bot.ip is
  'IP de origen; se usa solo para acotar el volumen de consultas por minuto.';

/*
  Cuenta las consultas registradas desde una IP en los últimos `p_minutos`.

  La decisión de aceptar o no la toma la aplicación: acá solo se provee el dato,
  que es lo que la base puede responder rápido gracias al índice.
*/
create or replace function consultas_recientes_de_ip(p_ip inet, p_minutos int default 1)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from consultas_bot
  where ip = p_ip
    and creado_en > now() - make_interval(mins => p_minutos);
$$;

comment on function consultas_recientes_de_ip(inet, int) is
  'Consultas del asistente registradas desde una IP en los últimos minutos (límite de volumen).';

grant execute on function consultas_recientes_de_ip(inet, int) to service_role;
