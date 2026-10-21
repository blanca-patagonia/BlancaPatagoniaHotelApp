-- ════════════════════════════════════════════════════════════════════════════
-- 0114 · `aplicar_precio_reserva` también escribe el desglose
-- ════════════════════════════════════════════════════════════════════════════
--
-- La 0085 dejó coherentes, en una transacción, el precio por noche de la
-- estadía y el total de la reserva. Pero el DESGLOSE (`subtotal`, `total_neto`,
-- `iva`, de la 0039) quedaba con los valores del alta: después de reprogramar o
-- de recotizar por mudanza, `total_neto + iva` dejaba de ser `total`. La ficha
-- lo detectaba y pedía «cargar el desglose antes de emitir» —sin forma de
-- hacerlo— y el listado en modo «sin impuestos» sumaba el neto viejo.
--
-- Se agregan tres parámetros opcionales. `null` = no se toca, así que quien la
-- llama como antes sigue funcionando igual.
--
-- ⚠️ DROP + CREATE y no `create or replace`: cambiar los argumentos con
-- `create or replace` crea una SOBRECARGA, y PostgREST puede resolver a la
-- vieja (es la regla que dejó `crear_reserva`, ver CLAUDE.md). Y como una
-- función nace con EXECUTE para PUBLIC, el `revoke` se rehace al final.

drop function if exists aplicar_precio_reserva(uuid, numeric, numeric, date, date);

create function aplicar_precio_reserva(
  p_reserva_id   uuid,
  p_precio_noche numeric,
  p_total        numeric,
  -- Período nuevo. `null` = no se toca (recotización por mudanza).
  p_check_in     date    default null,
  p_check_out    date    default null,
  -- Desglose de la cotización nueva. `null` = no se toca.
  p_subtotal     numeric default null,
  p_total_neto   numeric default null,
  p_iva          numeric default null
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
  if coalesce(p_subtotal, 0) < 0 or coalesce(p_total_neto, 0) < 0 or coalesce(p_iva, 0) < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'desglose');
  end if;

  if (p_check_in is null) <> (p_check_out is null) then
    return jsonb_build_object('ok', false, 'motivo', 'fechas');
  end if;
  if p_check_in is not null and p_check_out <= p_check_in then
    return jsonb_build_object('ok', false, 'motivo', 'fechas');
  end if;

  -- `for update`: dos reprogramaciones simultáneas se serializan (igual que 0085).
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

  -- `security invoker`: si RLS bloquea, el update afecta cero filas SIN lanzar.
  -- Sin esta guarda la función devolvería «listo» sin haber hecho nada (0085).
  if not found then
    raise exception 'No se pudo actualizar la estadía de la reserva %', p_reserva_id
      using errcode = '42501';
  end if;

  update reservas
  set total      = p_total,
      subtotal   = coalesce(p_subtotal, subtotal),
      total_neto = coalesce(p_total_neto, total_neto),
      iva        = coalesce(p_iva, iva)
  where id = p_reserva_id;

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
    -- El período nuevo pisa otra estadía activa de la unidad: se aborta TODO
    -- (ADR 0002 funcionando, no una falla).
    return jsonb_build_object('ok', false, 'motivo', 'ocupada');
end;
$$;

comment on function aplicar_precio_reserva is
  'Deja el precio por noche de la estadía, el total de la reserva y —desde la 0114— su desglose (subtotal, neto, IVA) coherentes en UNA transacción, y opcionalmente mueve el período. Los parámetros del desglose son opcionales: null no los toca.';

revoke execute on function aplicar_precio_reserva(uuid, numeric, numeric, date, date, numeric, numeric, numeric)
  from public;

grant execute on function aplicar_precio_reserva(uuid, numeric, numeric, date, date, numeric, numeric, numeric)
  to authenticated, service_role;
