-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0007 — Alta atómica de reserva (Fase 2)
-- Crea la reserva y su estadía en una única transacción. Si el período se solapa
-- con otra estadía activa, la restricción de exclusión aborta TODA la operación
-- (no queda una reserva huérfana) y se devuelve un error claro.
--
-- SECURITY INVOKER (por defecto): corre con el rol del que llama, de modo que las
-- políticas RLS deciden quién puede crear reservas (recepción+ o service_role).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function crear_reserva(
  p_huesped_id     uuid,
  p_unidad_id      uuid,
  p_tipo_unidad_id uuid,
  p_check_in       date,
  p_check_out      date,
  p_huespedes      int,
  p_precio_noche   numeric,
  p_total          numeric,
  p_canal          text            default 'directo',
  p_tarifa_tipo    text            default 'rack',
  p_estado         estado_reserva  default 'confirmada',
  p_promocion_id   uuid            default null,
  p_politica_id    uuid            default null,
  p_notas          text            default ''
) returns reservas
language plpgsql
as $$
declare
  v_reserva reservas;
begin
  if p_check_out <= p_check_in then
    raise exception 'El check-out debe ser posterior al check-in'
      using errcode = '22007';
  end if;

  insert into reservas (
    huesped_id, estado, canal, tarifa_tipo, promocion_id, politica_id,
    total, notas, creada_por
  ) values (
    p_huesped_id, p_estado, p_canal, p_tarifa_tipo, p_promocion_id, p_politica_id,
    p_total, p_notas, auth.uid()
  ) returning * into v_reserva;

  insert into estadias (
    reserva_id, unidad_id, tipo_unidad_id, periodo, estado, precio_noche, huespedes
  ) values (
    v_reserva.id, p_unidad_id, p_tipo_unidad_id,
    daterange(p_check_in, p_check_out, '[)'), p_estado, p_precio_noche, p_huespedes
  );

  return v_reserva;
exception
  when exclusion_violation then
    -- La unidad se ocupó en paralelo: se aborta todo y se informa con claridad.
    raise exception 'La unidad ya no está disponible para esas fechas'
      using errcode = '23P01';
end;
$$;

comment on function crear_reserva is
  'Alta atómica reserva + estadía; la exclusión anti-overbooking aborta la operación completa si hay solape.';

grant execute on function crear_reserva(
  uuid, uuid, uuid, date, date, integer, numeric, numeric,
  text, text, estado_reserva, uuid, uuid, text
) to authenticated, service_role;
