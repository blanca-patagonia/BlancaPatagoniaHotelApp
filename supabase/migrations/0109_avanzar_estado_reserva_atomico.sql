-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0109 — El camino de estados de una reserva, en UNA transacción
-- (issue #85 — atomicidad en los flujos de varios pasos de reservas)
--
-- ── El defecto ────────────────────────────────────────────────────────────────
--
-- `saldarSiCorresponde` (lib/reservas/saldar.ts) calcula el camino entre el
-- estado actual y el que corresponde según lo cobrado —`pendiente → pagada` no
-- es una transición válida: hay que pasar por `confirmada`— y después lo
-- recorre con un `for` que hace un `update` POR PASO, cada uno un viaje
-- separado a la base.
--
-- Si el primer `update` (a `confirmada`) sale bien y el segundo (a `pagada`)
-- falla —una caída de red, un RLS que lo bloquea—, la reserva queda en
-- `confirmada` para siempre: ya se cobró todo, pero el sistema sigue
-- mostrándola como si sólo estuviera garantizada con la seña. Nadie vuelve a
-- llamar a esta función para ESA reserva salvo que llegue otro pago, así que no
-- se autocorrige. Es el caso exacto del issue: "un fallo a mitad de camino
-- avisa pero deja los datos incompletos".
--
-- ── Por qué no se salta directo al estado final ──────────────────────────────
--
-- `reservas_estado_auditoria` (0020) audita cada cambio de `estado` por
-- separado: saltar de `pendiente` a `pagada` de un salto borraría el rastro de
-- que la reserva pasó por `confirmada` (cuándo quedó garantizada con la seña),
-- que es justo el dato que esa auditoría existe para no perder. Así que el
-- camino se sigue recorriendo paso a paso — lo que cambia es que ahora los
-- pasos son una sola transacción: todos entran o no entra ninguno.
--
-- ── Por qué no se reimplementa la máquina de estados acá ─────────────────────
--
-- `TRANSICIONES` (lib/domain/reservas.ts) ya decide qué caminos son válidos.
-- Copiar esa tabla a SQL es la misma trampa que ya separó una regla de plata en
-- dos copias que terminaron divergiendo (por eso existe este mismo archivo:
-- `saldarSiCorresponde` existe para que el mostrador y el webhook no vuelvan a
-- tener su propia versión de "cuándo pasar a pagada"). En vez de eso, la
-- función recibe el camino YA CALCULADO por el dominio y sólo se asegura de
-- aplicarlo entero o nada, bloqueando la fila contra una transición concurrente.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function avanzar_estado_reserva(
  p_reserva_id uuid,
  -- El estado desde el que se calculó `p_camino`. Si alguien más ya movió la
  -- reserva entre esa lectura y que esta función la bloquea, no se aplica un
  -- camino calculado contra un punto de partida que ya no es el actual.
  p_desde      estado_reserva,
  p_camino     text[]
)
returns jsonb
language plpgsql
security invoker            -- respeta el RLS de quien llama, igual que el resto
set search_path = public
as $$
declare
  v_actual estado_reserva;
  v_paso   text;
begin
  if p_camino is null or array_length(p_camino, 1) is null then
    return jsonb_build_object('ok', false, 'motivo', 'camino_vacio');
  end if;

  -- `for update` bloquea la fila: dos llamadas concurrentes para la misma
  -- reserva (el mostrador cobrando y el webhook avisando el mismo pago) se
  -- serializan en vez de pisarse, mismo recaudo que `aplicar_precio_reserva`.
  select estado into v_actual from reservas where id = p_reserva_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sin_reserva');
  end if;

  if v_actual <> p_desde then
    return jsonb_build_object('ok', false, 'motivo', 'estado_cambio', 'actual', v_actual);
  end if;

  foreach v_paso in array p_camino loop
    update reservas set estado = v_paso::estado_reserva where id = p_reserva_id;

    /*
      ⚠️ Se comprueba que el `update` haya tocado la fila, y no es paranoia.

      La función es `security invoker`: si el RLS de `reservas` no le permite
      escribir a quien llama, el `update` NO LANZA — afecta cero filas y sigue.
      Sin esta guarda, la función devolvería `ok: true` sin haber movido la
      reserva a ningún lado, que es la misma incoherencia que vino a evitar
      pero con un «listo» en pantalla (mismo recaudo que 0085).
    */
    if not found then
      raise exception 'No se pudo actualizar el estado de la reserva % a %', p_reserva_id, v_paso
        using errcode = '42501';
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'estado', v_paso);
end;
$$;

comment on function avanzar_estado_reserva is
  'Recorre el camino de estados de una reserva (p.ej. pendiente→confirmada→pagada) en UNA transacción: todos los pasos se aplican o no se aplica ninguno. Antes era un update por paso desde la aplicación, y un fallo a mitad de camino dejaba la reserva en un estado intermedio para siempre (issue #85).';

/*
  El grant.

  Una función nace con `EXECUTE` para PUBLIC, y `tests/funciones-sin-public.test.ts`
  falla si alguna queda abierta. `security invoker` hace que RLS siga decidiendo
  quién puede escribir qué: el grant sólo dice quién puede intentarlo. `service_role`
  además de `authenticated` porque la llama el webhook de pagos, que no tiene sesión.
*/
revoke execute on function avanzar_estado_reserva(uuid, estado_reserva, text[])
  from public;

grant execute on function avanzar_estado_reserva(uuid, estado_reserva, text[])
  to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Camino de dos pasos (pendiente → confirmada → pagada):
--   select avanzar_estado_reserva('<reserva pendiente>', 'pendiente', array['confirmada','pagada']);
--
--   -- Punto de partida que ya cambió (otra llamada concurrente la adelantó):
--   --   → {"ok": false, "motivo": "estado_cambio", "actual": "pagada"} y NADA cambió.
--
--   select * from funciones_expuestas_a_publico();  -- sin avanzar_estado_reserva
