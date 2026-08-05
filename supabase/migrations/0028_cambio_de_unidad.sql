-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0028 — Cambio de unidad de una reserva ("mudanza")
--
-- Hueco que arrastraba el sistema: la unidad se asignaba al crear la reserva y
-- después NO había forma de cambiarla. En un hotel eso pasa todos los días: se
-- rompe el calefactor, el huésped pide otra habitación, o hay que liberar una
-- unidad para acomodar un grupo.
--
-- Por qué es una función y no un `update` desde la aplicación: la mudanza son
-- dos escrituras que tienen que ir juntas —mover la estadía y dejar sucia la
-- unidad que se libera—. Si la segunda fallara por separado, la habitación
-- quedaría marcada como limpia con las sábanas usadas.
--
-- La garantía de que la unidad destino esté libre NO se programa acá: la impone
-- la restricción de exclusión `estadias_sin_solape` (ADR 0002). Si el destino
-- está ocupado, el `update` levanta 23P01 y la función entera se revierte.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function cambiar_unidad_reserva(
  p_reserva_id     uuid,
  p_unidad_destino uuid,
  p_motivo         text default ''
)
returns jsonb
language plpgsql
security invoker            -- respeta el RLS de quien llama, igual que el resto
set search_path = public
as $$
declare
  v_estadia        estadias%rowtype;
  v_unidad_origen  uuid;
  v_nombre_origen  text;
  v_nombre_destino text;
  v_tipo_destino   uuid;
  v_activo_destino boolean;
begin
  -- `for update` bloquea la fila: dos recepcionistas mudando la misma reserva
  -- al mismo tiempo se serializan en lugar de pisarse.
  select * into v_estadia
  from estadias
  where reserva_id = p_reserva_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sin_estadia');
  end if;

  v_unidad_origen := v_estadia.unidad_id;

  if v_unidad_origen = p_unidad_destino then
    return jsonb_build_object('ok', false, 'motivo', 'misma_unidad');
  end if;

  -- Misma regla que `lib/domain/mudanzas.ts`. Se repite a propósito: la
  -- aplicación no es la única puerta a la base (ver ADR 0005).
  if v_estadia.estado = 'checkout' then
    return jsonb_build_object('ok', false, 'motivo', 'finalizada');
  end if;

  if v_estadia.estado not in ('pendiente', 'confirmada', 'pagada', 'in_house') then
    return jsonb_build_object('ok', false, 'motivo', 'sin_inventario');
  end if;

  select tipo_unidad_id, activo, nombre
    into v_tipo_destino, v_activo_destino, v_nombre_destino
  from unidades
  where id = p_unidad_destino;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'destino_inexistente');
  end if;

  if not v_activo_destino then
    return jsonb_build_object('ok', false, 'motivo', 'destino_inactivo');
  end if;

  select nombre into v_nombre_origen from unidades where id = v_unidad_origen;

  -- Mover la estadía. El tipo también se actualiza: si no, una mudanza entre
  -- tipos distintos dejaría la estadía mintiendo sobre qué se vendió.
  -- Si la unidad destino ya está ocupada en esas fechas, esto levanta 23P01 y
  -- revierte todo lo anterior.
  update estadias
     set unidad_id = p_unidad_destino,
         tipo_unidad_id = v_tipo_destino
   where id = v_estadia.id;

  -- La unidad liberada queda sucia SOLO si el huésped llegó a ocuparla. Mudar
  -- una reserva que todavía no hizo el check-in no ensucia nada.
  if v_estadia.estado = 'in_house' then
    update unidades set estado = 'sucia' where id = v_unidad_origen;
  end if;

  return jsonb_build_object(
    'ok', true,
    'unidad_origen', v_unidad_origen,
    'unidad_destino', p_unidad_destino,
    'nombre_origen', v_nombre_origen,
    'nombre_destino', v_nombre_destino,
    'tipo_destino', v_tipo_destino,
    'cambio_de_tipo', v_tipo_destino is distinct from v_estadia.tipo_unidad_id,
    'ensucio_origen', v_estadia.estado = 'in_house',
    'motivo', p_motivo
  );
end;
$$;

comment on function cambiar_unidad_reserva(uuid, uuid, text) is
  'Muda una reserva a otra unidad y ensucia la liberada, en una sola transacción. '
  'El destino ocupado lo rechaza la restricción de exclusión (23P01).';

grant execute on function cambiar_unidad_reserva(uuid, uuid, text)
  to authenticated, service_role;

-- ── Auditoría ────────────────────────────────────────────────────────────────
-- Una mudanza mueve inventario y puede cambiar lo que se vendió, así que entra
-- en la misma bitácora que los pagos y las tarifas (migración 0020). Solo se
-- audita el cambio de unidad: auditar cada `update` de estadías registraría
-- también las reprogramaciones de fecha y llenaría la tabla de ruido.
create trigger estadias_unidad_auditoria
  after update on estadias
  for each row
  when (old.unidad_id is distinct from new.unidad_id)
  execute function registrar_auditoria();
