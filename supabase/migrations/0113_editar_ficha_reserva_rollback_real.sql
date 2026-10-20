-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0113 — `editar_ficha_reserva` no revertía de verdad (corrige la 0112)
--
-- ── El bug, encontrado al revisar la 0112 antes de darla por buena ─────────
--
-- La función de la migración anterior comprobaba `not found` después del
-- `update estadias` y, si fallaba, hacía un `return jsonb_build_object('ok',
-- false, ...)` plano. Un `return` **no deshace** lo que la misma llamada ya
-- escribió: el `update reservas` de la línea de arriba quedaba confirmado
-- igual, con la función entera devolviendo `ok: false`. Exactamente el
-- defecto que la 0112 decía estar corrigiendo (issue #85), solo que un nivel
-- más adentro — y más difícil de notar, porque el síntoma es «dijo que
-- falló» en vez de «dijo que anduvo».
--
-- `aplicar_precio_reserva` (0085) ya tiene el patrón correcto en su propio
-- comentario («`raise` deshace todo lo escrito en la transacción») y esta
-- función no lo había seguido para su segundo `update`. Se corrige acá:
-- `raise exception` en vez de `return` después de la primera escritura, para
-- que el error real deshaga la transacción completa. El llamador
-- (`app/panel/reservas/actions.ts`) ya está preparado para este camino: lo
-- recibe como `error` de la llamada RPC —no como `resultado.ok`— y lo trata
-- con `cortarSiFalla`, igual que cualquier otra escritura fallida.
--
-- Se vuelve a crear la función entera (mismo nombre y firma, no hace falta
-- `drop` porque los parámetros no cambian) con `create or replace`.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function editar_ficha_reserva(
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
  -- Nada se escribió todavía: un `return` acá no necesita deshacer nada.
  update reservas
  set plan = p_plan, segmento = p_segmento, voucher = p_voucher, notas = p_notas
  where id = p_reserva_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_no_encontrada');
  end if;

  /*
    ⚠️ Acá SÍ ya se escribió (el `update reservas` de arriba). Un `return`
    en este punto dejaría esa escritura confirmada con la función entera
    devolviendo `ok: false` — la ficha quedaría a medias con un mensaje de
    error que no dice toda la verdad. Es justo el bug de la 0112.
    `raise exception` deshace TODO lo escrito en la transacción; el
    llamador lo recibe como `error` de la llamada RPC, no como
    `{ ok: false }`, y lo trata igual que cualquier otra escritura
    fallida (`cortarSiFalla`).
  */
  update estadias
  set adultos = p_adultos,
      menores = p_menores,
      bebes = p_bebes,
      cunas = p_cunas,
      no_mover = p_no_mover,
      -- Misma derivación que `crear_reserva`: los bebés no ocupan plaza.
      huespedes = greatest(p_adultos + p_menores, 1)
  -- `estadia_id` Y `reserva_id`: el segundo filtro es una red extra contra un
  -- id de estadía que, por el motivo que sea, no corresponda a esta reserva.
  where id = p_estadia_id and reserva_id = p_reserva_id;
  if not found then
    raise exception 'No se pudo actualizar la estadía % de la reserva %', p_estadia_id, p_reserva_id
      using errcode = '42501';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function editar_ficha_reserva is
  'Guarda la ficha de reserva (plan, segmento, voucher, notas, composición, cunas, no_mover) en una sola transacción. Si el update de estadias fallara después de guardar reservas, un `raise exception` revierte entero en vez de dejar la ficha a medio editar (corregido en la 0113: la 0112 usaba un `return` que no revertía de verdad).';

-- `create or replace` no toca los privilegios existentes, pero se repite el
-- `revoke`/`grant` de la 0112 por las dudas: una función nunca debe depender
-- de que una migración anterior haya corrido para quedar cerrada a PUBLIC.
revoke execute on function editar_ficha_reserva(uuid, uuid, text, text, text, text, int, int, int, int, boolean) from public;
grant execute on function editar_ficha_reserva(uuid, uuid, text, text, text, text, int, int, int, int, boolean) to authenticated, service_role;
