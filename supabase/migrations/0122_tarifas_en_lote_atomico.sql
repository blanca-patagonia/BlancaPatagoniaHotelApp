-- ════════════════════════════════════════════════════════════════════════════
-- 0122 · Las tarifas se actualizan en lote, todas o ninguna
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── El problema (análisis del proyecto, 2026-10-20) ──────────────────────────
--
-- Las dos acciones que tocan varias tarifas de una vez
-- (`panel/config/tarifas.actions.ts`):
--
--   · `actualizarTarifasDeFila`: las tres temporadas de un tipo de unidad.
--   · `aplicarPorcentajeTarifario`: TODO el tarifario un mismo porcentaje.
--
-- hacían un `update` por tarifa en un bucle. Validaban todo antes de escribir,
-- pero una vez que empezaban, si fallaba la tarifa número 7 de 20 las seis
-- primeras ya tenían el precio nuevo y el resto el viejo. El propio código lo
-- decía: «no hay función SQL transaccional para esto todavía». Un tarifario a
-- medio subir no se ve roto: cotiza, con precios que nadie decidió.
--
-- ── El arreglo ───────────────────────────────────────────────────────────────
--
-- Una sola llamada con todo el lote. Una función es una sola sentencia, así
-- que corre en una transacción: si una fila falla, no queda ninguna escrita.
--
-- · `security invoker`: escribe con los permisos de quien llama, así que la
--   política «tarifas: admin/gerencia gestionan» (0003) sigue siendo la que
--   decide. NO hacerla `security definer`: saltearía esa política.
-- · Comprueba `FOUND` después de cada `update`. Un `update` que RLS bloquea
--   afecta cero filas y NO lanza (ver la 0085): sin esta comprobación, una
--   recepcionista recibiría «listo» sin haber cambiado nada, y un id que no
--   existe pasaría igual.
-- · Repite las validaciones de la acción (importes no negativos, neto ≤ rack).
--   La base ya tiene `check (precio_* >= 0)`, pero no la relación entre los
--   dos: el neto es el precio de agencia y nunca puede superar al de mostrador.

create function actualizar_tarifas_en_lote(p_cambios jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cambio jsonb;
  v_neto   numeric;
  v_rack   numeric;
  v_total  int := 0;
begin
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'array' or jsonb_array_length(p_cambios) = 0 then
    raise exception 'El lote de tarifas tiene que ser una lista con al menos un cambio.'
      using errcode = '22023';
  end if;

  for v_cambio in select * from jsonb_array_elements(p_cambios)
  loop
    v_neto := (v_cambio ->> 'neto')::numeric;
    v_rack := (v_cambio ->> 'rack')::numeric;

    if v_neto is null or v_rack is null or v_neto < 0 or v_rack < 0 then
      raise exception 'Los importes de la tarifa % tienen que ser números positivos.', v_cambio ->> 'id'
        using errcode = '22023';
    end if;
    if v_neto > v_rack then
      raise exception 'En la tarifa % el neto (agencia) supera al rack (mostrador).', v_cambio ->> 'id'
        using errcode = '22023';
    end if;

    update tarifas
       set precio_neto = v_neto,
           precio_rack = v_rack
     where id = (v_cambio ->> 'id')::uuid;

    if not found then
      raise exception 'No se pudo actualizar la tarifa %: no existe o no tenés permiso.', v_cambio ->> 'id'
        using errcode = '42501';
    end if;

    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

comment on function actualizar_tarifas_en_lote(jsonb) is
  'Actualiza neto y rack de varias tarifas en una sola transacción: todas o ninguna. Recibe [{id, neto, rack}]. security invoker: decide la política de `tarifas` (0122).';

-- Nace abierta a PUBLIC (y, en una base nueva, a `anon` directo: ver 0119).
revoke all on function actualizar_tarifas_en_lote(jsonb) from public, anon;
grant execute on function actualizar_tarifas_en_lote(jsonb) to authenticated, service_role;
