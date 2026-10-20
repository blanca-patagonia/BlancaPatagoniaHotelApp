-- ════════════════════════════════════════════════════════════════════════════
-- 0117 · Registro de la última corrida de cada tarea programada
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un cron que deja de correr no avisa: no hay error que registrar porque no
-- pasa nada. Si Vercel deja de llamar (falta `CRON_SECRET`, el plan no admite
-- la frecuencia, se borró del `vercel.json`), las reservas pendientes dejan de
-- expirar y los avisos dejan de salir, y el hotel lo descubre por sus efectos.
--
-- Cada cron anota acá cuándo terminó bien por última vez. El panel compara
-- contra la frecuencia esperada (`lib/domain/crons.ts`) y avisa cuando una
-- tarea lleva demasiado sin correr.
--
-- Lo escribe sólo `service_role` (los crons); lo leen admin y gerencia. Mismo
-- esquema de permisos que `errores` (0068).

create table cron_corridas (
  nombre          text primary key,
  ultima_ok       timestamptz,
  ultima_falla    timestamptz,
  detalle_falla   text not null default '',
  actualizado_en  timestamptz not null default now()
);

comment on table cron_corridas is
  'Última corrida correcta (y la última fallida) de cada tarea programada. Una tarea que deja de correr no genera errores: esto es lo que permite notarlo.';

alter table cron_corridas enable row level security;

create policy "cron_corridas: admin y gerencia leen"
  on cron_corridas for select
  using (rol_actual() in ('admin', 'gerencia'));

-- Sin políticas de escritura: la escriben los crons con `service_role`.
revoke insert, update, delete on cron_corridas from authenticated;
revoke select, insert, update, delete on cron_corridas from anon;
