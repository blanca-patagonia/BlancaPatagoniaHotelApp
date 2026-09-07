-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0084 — La reserva de agencia nace con su agencia
-- (Auditoría 2026-09, hallazgo P1-7)
--
-- ── El defecto ───────────────────────────────────────────────────────────────
--
-- `crearReserva` da de alta la reserva con `crear_reserva` —que es atómica— y
-- **después**, en un `update` aparte, le pone `agencia_id`:
--
--     const res = await crearReservaEnUnidadLibre(supabase, {...})
--     if (agenciaId) {
--       await supabase.from('reservas').update({ agencia_id: agenciaId })...
--     }
--
-- Si ese segundo paso falla, la reserva **existe y no está vinculada a nadie**.
-- Y ese vínculo no es decorativo: es lo que decide a quién se le factura, qué
-- tarifa corresponde (neto de agencia contra rack de mostrador, ADR 0004) y qué
-- cuenta corriente se debita. Una reserva de agencia sin `agencia_id` es una
-- estadía que el hotel presta y no le cobra a nadie.
--
-- ── Por qué se resuelve acá y no con un reintento ────────────────────────────
--
-- Es el mismo razonamiento que la migración 0039 dejó escrito cuando agregó el
-- desglose de ocupación, textual: *«un `update` posterior podría fallar y dejar
-- la reserva creada con el desglose a medias, que es justo lo que la atomicidad
-- de esta función evita»*. El desglose se resolvió así y el vínculo con la
-- agencia quedó afuera; esta migración lo alinea.
--
-- ⚠️ **DROP y CREATE, no `create or replace`.** Cambiar la lista de argumentos
-- crea una **sobrecarga** en vez de reemplazar, y con dos versiones conviviendo
-- una llamada por nombre puede resolverse a la equivocada — o directamente
-- fallar con «could not choose the best candidate function». Es la misma nota
-- que la 0039 dejó, y sigue valiendo.
--
-- ⚠️ Al recrear la función hay que **rehacer el `revoke ... from public`**: una
-- función nace con `EXECUTE` para PUBLIC, y `tests/funciones-sin-public.test.ts`
-- falla si alguna queda abierta. Es la trampa que la 0070 cerró para el resto.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists crear_reserva(
  uuid, uuid, uuid, date, date, integer, numeric, numeric,
  text, text, estado_reserva, uuid, uuid, text,
  integer, integer, integer, integer, integer, boolean,
  text, text, text, text, uuid, numeric, numeric, numeric, numeric
);

create function crear_reserva(
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
  p_notas          text            default '',
  -- ── Desglose de ocupación (paso 6 de la modernización WinPAX) ──
  p_adultos        int             default null,
  p_menores        int             default 0,
  p_bebes          int             default 0,
  p_camas_extra    int             default 0,
  p_cunas          int             default 0,
  p_no_mover       boolean         default false,
  -- ── Datos comerciales ──
  p_plan           text            default 'desayuno',
  p_garantia       text            default 'sin_garantia',
  p_segmento       text            default 'particular',
  p_voucher        text            default '',
  p_contrato_id    uuid            default null,
  p_descuento_pct  numeric         default 0,
  p_subtotal       numeric         default 0,
  p_total_neto     numeric         default 0,
  p_iva            numeric         default 0,
  /*
    ── El parámetro nuevo (P1-7) ──

    Va al final y con valor por omisión, así que las llamadas existentes —que
    pasan argumentos con nombre— siguen funcionando sin cambios. `null` es el
    caso normal: la reserva del portal público y la del mostrador sin convenio no
    tienen agencia.
  */
  p_agencia_id     uuid            default null
) returns reservas
language plpgsql
as $$
declare
  v_reserva  reservas;
  v_adultos  int;
  v_huespedes int;
begin
  if p_check_out <= p_check_in then
    raise exception 'El check-out debe ser posterior al check-in'
      using errcode = '22007';
  end if;

  -- Coherencia del pax, resuelta en un solo lugar.
  --
  -- Con desglose, `huespedes` se DERIVA de él (los bebés no cuentan: no ocupan
  -- plaza). Sin desglose, se conserva el comportamiento histórico. Así las dos
  -- columnas nunca nacen contradiciéndose, sin necesidad de un `check` que
  -- rompería los `update` de mudanza y reprogramación.
  v_adultos := coalesce(p_adultos, p_huespedes);
  v_huespedes := greatest(v_adultos + p_menores, 1);

  insert into reservas (
    huesped_id, estado, canal, tarifa_tipo, promocion_id, politica_id,
    total, notas, creada_por,
    plan, garantia, segmento, voucher, contrato_id,
    descuento_pct, subtotal, total_neto, iva,
    agencia_id
  ) values (
    p_huesped_id, p_estado, p_canal, p_tarifa_tipo, p_promocion_id, p_politica_id,
    p_total, p_notas, auth.uid(),
    p_plan, p_garantia, p_segmento, p_voucher, p_contrato_id,
    p_descuento_pct, p_subtotal, p_total_neto, p_iva,
    p_agencia_id
  ) returning * into v_reserva;

  insert into estadias (
    reserva_id, unidad_id, tipo_unidad_id, periodo, estado, precio_noche, huespedes,
    adultos, menores, bebes, camas_extra, cunas, no_mover
  ) values (
    v_reserva.id, p_unidad_id, p_tipo_unidad_id,
    daterange(p_check_in, p_check_out, '[)'), p_estado, p_precio_noche, v_huespedes,
    v_adultos, p_menores, p_bebes, p_camas_extra, p_cunas, p_no_mover
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
  'Alta atómica reserva + estadía; la exclusión anti-overbooking aborta la operación completa si hay solape. Deriva `estadias.huespedes` del desglose. Desde la 0084 recibe también `agencia_id`: vincularla después, en un update aparte, dejaba reservas de agencia sin agencia si ese paso fallaba (P1-7).';

/*
  El grant, con la firma NUEVA.

  Una función recién creada trae `EXECUTE` para PUBLIC. Si esto faltara,
  `tests/funciones-sin-public.test.ts` fallaría nombrándola — que es exactamente
  para lo que ese test existe.
*/
revoke execute on function crear_reserva(
  uuid, uuid, uuid, date, date, integer, numeric, numeric,
  text, text, estado_reserva, uuid, uuid, text,
  integer, integer, integer, integer, integer, boolean,
  text, text, text, text, uuid, numeric, numeric, numeric, numeric,
  uuid
) from public;

grant execute on function crear_reserva(
  uuid, uuid, uuid, date, date, integer, numeric, numeric,
  text, text, estado_reserva, uuid, uuid, text,
  integer, integer, integer, integer, integer, boolean,
  text, text, text, text, uuid, numeric, numeric, numeric, numeric,
  uuid
) to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Una sola versión de la función, no dos:
--   select count(*) from pg_proc where proname = 'crear_reserva';   -- 1
--
--   -- No quedó abierta a PUBLIC:
--   select * from funciones_expuestas_a_publico();  -- sin crear_reserva
--
--   -- La reserva nace con su agencia, en la misma transacción:
--   select agencia_id from crear_reserva(
--     p_huesped_id => '…', p_unidad_id => '…', p_tipo_unidad_id => '…',
--     p_check_in => '2031-01-01', p_check_out => '2031-01-03',
--     p_huespedes => 2, p_precio_noche => 100, p_total => 200,
--     p_agencia_id => '…'
--   );
