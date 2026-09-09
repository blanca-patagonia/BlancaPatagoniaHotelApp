-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0087 — `cancelada_en`, para saber CUÁNDO se canceló una reserva
--
-- El tablero principal (`app/panel/page.tsx`) muestra llegadas y salidas de
-- hoy, pero no cancelaciones de hoy: `reservas` no guardaba cuándo pasó a
-- `cancelada`, solo el estado actual. Sin esa fecha, «canceladas hoy» y
-- «canceladas el mes pasado» son indistinguibles.
--
-- Se resuelve con un trigger, no dejando que cada Server Action lo escriba a
-- mano: mismo patrón que `reservas_estado_sync` (migración 0005), porque una
-- reserva puede cancelarse desde más de un lugar (el panel, la expiración
-- automática de `expirar_reservas_pendientes`) y todos tienen que quedar
-- cubiertos sin acordarse de repetir la escritura.
-- ─────────────────────────────────────────────────────────────────────────────

alter table reservas add column cancelada_en timestamptz;
comment on column reservas.cancelada_en is
  'Momento en que la reserva pasó a cancelada. Null si nunca se canceló.';

create or replace function marcar_cancelacion_de_reserva()
returns trigger language plpgsql as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' then
    new.cancelada_en := now();
  end if;
  return new;
end;
$$;

-- BEFORE, no AFTER: escribe el mismo campo de la fila que ya se está guardando,
-- así no hace falta un segundo UPDATE (que además volvería a disparar la
-- auditoría de la migración 0020 por un cambio que no la necesita).
create trigger reservas_marcar_cancelacion
  before update of estado on reservas
  for each row
  execute function marcar_cancelacion_de_reserva();
