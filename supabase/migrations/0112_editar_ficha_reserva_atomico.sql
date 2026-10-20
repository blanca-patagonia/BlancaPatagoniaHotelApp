-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0112 — Editar ficha de reserva, en una transacción (issue #85)
--
-- ── Qué corrige ──────────────────────────────────────────────────────────────
--
-- `editarFichaReserva` (`app/panel/reservas/actions.ts`, sumada en la pasada
-- anterior de esta misma auditoría) escribía `reservas` y `estadias` con dos
-- `update` sueltos. El propio código lo admitía: si el segundo fallaba, el
-- primero ya había quedado guardado y no había vuelta atrás. Es la misma
-- forma del problema que ya resolvieron `aplicar_precio_reserva` (0085) y
-- `avanzar_estado_reserva` (0109) para reprogramar y cambiar de estado — acá
-- faltaba la tercera pieza.
--
-- ── Por qué NO revalida capacidad ni plan/segmento acá ──────────────────────
--
-- La validación (¿entran estas personas en esta unidad?, ¿el plan es uno de
-- los que existen?) ya la hace `editarFichaReserva` en TypeScript con
-- `validarOcupantes`/`PLANES`/`SEGMENTOS` antes de llamar a esta función —
-- mismo criterio que `aplicar_precio_reserva`, que recibe el precio ya
-- cotizado y no vuelve a cotizar. Esta función asume valores ya válidos y
-- sólo garantiza que las dos escrituras ocurran juntas o ninguna.
--
-- `security invoker` (como el resto): respeta el RLS de quien llama, y cada
-- `update` se verifica con `FOUND` — sin eso, un RLS que bloquee una fila
-- afecta cero filas sin lanzar, y la función devolvería éxito sin haber
-- escrito nada.
-- ─────────────────────────────────────────────────────────────────────────────

create function editar_ficha_reserva(
  p_reserva_id uuid,
  p_estadia_id uuid,
  p_plan text,
  p_segmento text,
  p_voucher text,
  p_notas text,
  p_adultos int,
  p_menores int,
  p_bebes int,
  p_cunas int,
  p_no_mover boolean
)
returns jsonb
language plpgsql
security invoker            -- respeta el RLS de quien llama, igual que el resto
as $$
begin
  update reservas
  set plan = p_plan, segmento = p_segmento, voucher = p_voucher, notas = p_notas
  where id = p_reserva_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_no_encontrada');
  end if;

  -- `estadia_id` Y `reserva_id`: el segundo filtro es una red extra contra un
  -- id de estadía que, por el motivo que sea, no corresponda a esta reserva.
  update estadias
  set adultos = p_adultos,
      menores = p_menores,
      bebes = p_bebes,
      cunas = p_cunas,
      no_mover = p_no_mover,
      -- Misma derivación que `crear_reserva`: los bebés no ocupan plaza.
      huespedes = greatest(p_adultos + p_menores, 1)
  where id = p_estadia_id and reserva_id = p_reserva_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'estadia_no_encontrada');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function editar_ficha_reserva is
  'Guarda la ficha de reserva (plan, segmento, voucher, notas, composición, cunas, no_mover) en una sola transacción. Si el update de estadias fallara después de guardar reservas, revierte entero en vez de dejar la ficha a medio editar.';

revoke execute on function editar_ficha_reserva(uuid, uuid, text, text, text, text, int, int, int, int, boolean) from public;
grant execute on function editar_ficha_reserva(uuid, uuid, text, text, text, text, int, int, int, int, boolean) to authenticated, service_role;
