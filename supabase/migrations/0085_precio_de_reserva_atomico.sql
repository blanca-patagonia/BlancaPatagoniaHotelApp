-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0085 — El precio de la estadía y el total de la reserva, juntos
-- (Auditoría 2026-09, hallazgo P1-7 — lo que quedaba después de la 0084)
--
-- ── El defecto, que es el mismo en dos lugares ───────────────────────────────
--
-- Reprogramar y mudar terminan igual: escriben el precio por noche en `estadias`
-- y el total en `reservas` con **dos `update` separados**. El propio código lo
-- admite en los comentarios:
--
--   · reprogramación → *«Las fechas ya se movieron. Si el total no se actualiza,
--     la reserva queda con el precio de las fechas viejas»*.
--   · mudanza → *«La mudanza ya se hizo. Si el precio no se recotiza, la reserva
--     queda facturando la unidad anterior»*.
--
-- Los dos son la misma inconsistencia: **`reservas.total` contradiciendo al
-- `estadias.precio_noche` de su propia estadía**. Y no se ve: la reserva figura
-- normal en la grilla, con un total que no corresponde a lo que se está
-- ocupando. Se descubre al facturar, cuando ya hay un comprobante emitido.
--
-- ── Una función para los dos casos ───────────────────────────────────────────
--
-- Las dos operaciones necesitan exactamente lo mismo: dejar el precio y el total
-- coherentes en una sola transacción. Lo que las distingue es que reprogramar
-- **además** mueve el período, así que ese parámetro es opcional.
--
-- Escribir dos funciones casi iguales garantizaría que en algún momento una
-- reciba un arreglo que la otra no.
--
-- ⚠️ **Esto NO mete la recotización dentro de la mudanza**, y es deliberado: esa
-- decisión ya está tomada y escrita en `cambiarUnidadReserva` —«si fallara, el
-- huésped ya está mudado, que es lo urgente, y el precio se corrige a mano; al
-- revés, revertir la mudanza por un problema de tarifa, sería peor»—. Lo que
-- cambia es que la recotización deja de ser dos escrituras y pasa a ser una.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function aplicar_precio_reserva(
  p_reserva_id   uuid,
  p_precio_noche numeric,
  p_total        numeric,
  /*
    Período nuevo. `null` = no se toca (es el caso de la recotización por
    mudanza, donde las fechas no cambian).

    Va como dos fechas y no como `daterange` armado en la aplicación: componer el
    rango con `[)` es donde se cuela el error de un día, y la función ya sabe cuál
    es la convención del sistema.
  */
  p_check_in     date default null,
  p_check_out    date default null
)
returns jsonb
language plpgsql
security invoker            -- respeta el RLS de quien llama, igual que el resto
set search_path = public
as $$
declare
  v_estadia estadias%rowtype;
begin
  if p_precio_noche is null or p_precio_noche < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'precio');
  end if;
  if p_total is null or p_total < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'total');
  end if;

  -- Las dos fechas van juntas o no van: media reprogramación no significa nada.
  if (p_check_in is null) <> (p_check_out is null) then
    return jsonb_build_object('ok', false, 'motivo', 'fechas');
  end if;
  if p_check_in is not null and p_check_out <= p_check_in then
    return jsonb_build_object('ok', false, 'motivo', 'fechas');
  end if;

  /*
    `for update` bloquea la fila.

    Dos recepcionistas reprogramando la misma reserva al mismo tiempo se
    serializan en lugar de pisarse — es el mismo recaudo que toma
    `cambiar_unidad_reserva` (0028).
  */
  select * into v_estadia
  from estadias
  where reserva_id = p_reserva_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sin_estadia');
  end if;

  update estadias
  set precio_noche = p_precio_noche,
      periodo = case
        when p_check_in is null then periodo
        else daterange(p_check_in, p_check_out, '[)')
      end
  where id = v_estadia.id;

  /*
    ⚠️ Se comprueba que el `update` haya tocado la fila, y no es paranoia.

    La función es `security invoker`: si la política RLS de `estadias` no le
    permite escribir a quien llama, el `update` **no lanza** — afecta cero filas
    y sigue. Sin esta guarda, la función devolvería `ok: true` con la estadía
    intacta y el total ya cambiado: exactamente la incoherencia que viene a
    evitar, pero ahora con un «listo» en pantalla.

    `raise` deshace todo lo escrito en la transacción.
  */
  if not found then
    raise exception 'No se pudo actualizar la estadía de la reserva %', p_reserva_id
      using errcode = '42501';
  end if;

  update reservas set total = p_total where id = p_reserva_id;

  -- Lo mismo del otro lado. Acá además cubre el caso de que la reserva no exista,
  -- que no debería poder pasar teniendo la estadía, pero cuesta una línea.
  if not found then
    raise exception 'No se pudo actualizar el total de la reserva %', p_reserva_id
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'precio_noche', p_precio_noche,
    'total', p_total
  );
exception
  when exclusion_violation then
    /*
      El período nuevo pisa otra estadía activa de la misma unidad.

      Se aborta **todo**: sin esto, el precio y el total quedarían aplicados
      sobre unas fechas que no se pudieron mover. Es la garantía del ADR 0002
      trabajando, no una falla.
    */
    return jsonb_build_object('ok', false, 'motivo', 'ocupada');
end;
$$;

comment on function aplicar_precio_reserva is
  'Deja el precio por noche de la estadía y el total de la reserva coherentes en UNA transacción, y opcionalmente mueve el período. Antes eran dos `update` sueltos y un fallo en el segundo dejaba el total contradiciendo a la estadía: la reserva quedaba con el precio de las fechas viejas, o facturando la unidad anterior (P1-7).';

/*
  El grant.

  Una función nace con `EXECUTE` para PUBLIC, y `tests/funciones-sin-public.test.ts`
  falla si alguna queda abierta. `security invoker` hace que RLS siga decidiendo
  quién puede escribir qué: el grant sólo dice quién puede intentarlo.
*/
revoke execute on function aplicar_precio_reserva(uuid, numeric, numeric, date, date)
  from public;

grant execute on function aplicar_precio_reserva(uuid, numeric, numeric, date, date)
  to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Sólo precio (recotización por mudanza):
--   select aplicar_precio_reserva('<reserva>', 120, 240);
--
--   -- Precio + fechas (reprogramación):
--   select aplicar_precio_reserva('<reserva>', 120, 360, '2031-06-01', '2031-06-04');
--
--   -- Un período que pisa otra estadía de la misma unidad:
--   --   → {"ok": false, "motivo": "ocupada"} y NADA cambió, ni el precio ni el total.
--
--   select * from funciones_expuestas_a_publico();  -- sin aplicar_precio_reserva
