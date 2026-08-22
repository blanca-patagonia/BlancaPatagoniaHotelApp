-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0039 — Ficha de reserva completa (Modernización WinPAX, paso 6)
--
-- ── Qué falta y por qué importa ──────────────────────────────────────────────
--
-- La ficha de reserva de WinPAX tiene una veintena de campos que acá no existían.
-- No son adornos: son los datos con los que recepción prepara la habitación
-- (cuántos adultos, si hace falta cuna, si el huésped es VIP) y con los que
-- administración factura (plan, descuento, subtotal, IVA discriminado).
--
-- ── Las tres decisiones de diseño ────────────────────────────────────────────
--
-- 1. **Dónde va cada campo.** Los datos *comerciales* de la operación van en
--    `reservas` (plan, garantía, segmento, voucher, descuento, desglose de
--    importes). Los datos *físicos de la habitación* van en `estadias` (adultos,
--    menores, bebés, camas extra, cunas, «no mover»), porque una reserva grupal
--    tiene varias estadías y cada habitación se ocupa distinto. `vip` va en
--    `huespedes`: quien es VIP lo es siempre, no en una reserva puntual.
--
-- 2. **`estadias.huespedes` sigue siendo la fuente de verdad de la ocupación.**
--    Es la columna que alimentan las validaciones de capacidad y con la que se
--    razona el anti-overbooking (ADR 0002). El desglose se suma **sin** tocarla:
--    `crear_reserva` la **deriva** del desglose cuando se lo pasan
--    (`huespedes = adultos + menores`), así que las dos cosas nacen coherentes en
--    el único lugar donde se crean estadías.
--
--    ⚠️ **No se agrega un `check (adultos + menores = huespedes)`** a propósito.
--    Sería un invariante lindo y una trampa: los flujos de mudanza (0028) y de
--    reprogramación actualizan `unidad_id` y `periodo` sin tocar el pax, y
--    cualquier `insert` directo futuro que ponga sólo `huespedes` fallaría con un
--    error que no explica nada. La coherencia se garantiza en el único camino de
--    alta y se valida en el dominio (`lib/domain/ocupantes.ts`).
--
-- 3. **Los bebés no cuentan para la capacidad.** Un bebé en cuna no ocupa plaza:
--    si contara, una cabaña para 4 con dos adultos, un menor y un bebé daría
--    «completo» y el sistema rechazaría una reserva perfectamente válida. Es la
--    razón por la que `huespedes = adultos + menores` y no incluye `bebes`.
--
-- ── Qué NO se agrega, y no es un olvido ──────────────────────────────────────
--
-- Los datos de tarjeta de WinPAX (número, vencimiento, código de autorización y
-- **PIN**). Este sistema nunca los guardó y no va a empezar: `pagos` registra el
-- medio y el `external_id` de la pasarela, nada más. Guardar un PAN obliga a
-- cumplir PCI-DSS entero; el flujo correcto es tokenizado y lo provee la pasarela.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Huésped: VIP ─────────────────────────────────────────────────────────────
alter table huespedes
  add column vip boolean not null default false;

comment on column huespedes.vip is
  'Huésped VIP. Va en la ficha del huésped y no en la reserva: quien es VIP lo es siempre.';

-- Índice parcial: se consulta «los VIP», nunca «los que no son VIP», y los VIP
-- son pocos. Un índice sobre toda la tabla ocuparía lugar para nada.
create index huespedes_vip_idx on huespedes (apellido) where vip;

-- ── Reserva: datos comerciales ───────────────────────────────────────────────
alter table reservas
  -- Plan / pensión. El Tarifario del hotel incluye desayuno, así que ése es el
  -- valor por omisión y no «solo alojamiento».
  add column plan text not null default 'desayuno'
    check (plan in ('solo_alojamiento', 'desayuno', 'media_pension', 'pension_completa')),

  -- Cómo está garantizada la reserva. Es lo que decide si se puede cobrar un
  -- no-show: sin garantía no hay nada que cobrar (ADR 0019, sin resolver).
  add column garantia text not null default 'sin_garantia'
    check (garantia in ('sin_garantia', 'tarjeta', 'deposito', 'agencia', 'contrato')),

  -- Segmento de mercado, para los reportes de gerencia.
  add column segmento text not null default 'particular'
    check (segmento in ('particular', 'corporativo', 'grupo', 'ota', 'agencia')),

  -- Voucher del canal o de la agencia. Texto libre: cada agencia lo numera a su
  -- manera y no hay forma de validarlo.
  add column voucher text not null default '',

  -- Contrato que fija la tarifa, si la reserva entra por uno.
  add column contrato_id uuid references contratos (id),

  add column descuento_pct numeric(5, 2) not null default 0
    check (descuento_pct >= 0 and descuento_pct <= 100),

  -- ── Desglose de importes ───────────────────────────────────────────────────
  -- `total` ya existía y guarda el importe CON IVA. Faltaba el desglose, y sin él
  -- el neto no se podía recuperar: `tarifas.iva_pct` puede variar por tarifa, así
  -- que dividir el total por 1,21 daba un número aproximado y silenciosamente
  -- equivocado. Con estas tres columnas el listado puede mostrar «tarifa con o sin
  -- impuestos», que es lo que pedía el listado de WinPAX.
  add column subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  add column total_neto numeric(12, 2) not null default 0 check (total_neto >= 0),
  add column iva numeric(12, 2) not null default 0 check (iva >= 0);

comment on column reservas.plan is
  'Plan de comidas incluido. Por omisión «desayuno»: es lo que incluye el Tarifario del hotel.';
comment on column reservas.garantia is
  'Cómo está garantizada. Sin garantía no hay no-show cobrable (ver ADR 0019).';
comment on column reservas.subtotal is
  'Neto antes del descuento, sin IVA. `total` sigue siendo el importe final CON IVA.';
comment on column reservas.total_neto is
  'Neto después del descuento, sin IVA. `total` = total_neto + iva.';

create index reservas_segmento_idx on reservas (segmento);
create index reservas_contrato_idx on reservas (contrato_id);

-- ── Estadía: ocupación física de la habitación ───────────────────────────────
alter table estadias
  add column adultos     int     not null default 1 check (adultos >= 0),
  add column menores     int     not null default 0 check (menores >= 0),
  -- Los bebés se registran pero NO suman a `huespedes`: no ocupan plaza.
  add column bebes       int     not null default 0 check (bebes >= 0),
  add column camas_extra int     not null default 0 check (camas_extra >= 0),
  add column cunas       int     not null default 0 check (cunas >= 0),
  -- «No mover»: el huésped pidió esta habitación puntual (vista, planta baja, la
  -- de siempre). La pantalla de cambio de unidad tiene que avisarlo antes de
  -- mudarlo, o se pierde el motivo por el que se la asignaron.
  add column no_mover    boolean not null default false;

comment on column estadias.adultos is
  'Adultos alojados. Junto con `menores` compone `huespedes`, que sigue siendo la columna de capacidad.';
comment on column estadias.bebes is
  'Bebés en cuna. NO suman a `huespedes`: no ocupan plaza, y contarlos daría «completo» de más.';
comment on column estadias.no_mover is
  'El huésped pidió esta habitación en particular. Se avisa antes de cambiarlo de unidad.';

-- ── Retrocompatibilidad de los datos existentes ──────────────────────────────
-- Sin esto, toda estadía ya cargada diría «1 adulto» aunque tuviera 4 huéspedes,
-- y la ficha mostraría un dato falso en lugar de un dato ausente.
update estadias set adultos = huespedes where huespedes > 0;

-- ── Alta atómica: se extiende para recibir el desglose ───────────────────────
-- Se reemplaza `crear_reserva` en lugar de actualizar la estadía después, por dos
-- razones. La primera es que **es el único lugar donde nacen estadías** (lo usan
-- tanto el panel como el portal público y la importación de canales), así que
-- garantizar la coherencia acá la garantiza en todos lados. La segunda es que un
-- `update` posterior podría fallar y dejar la reserva creada con el desglose a
-- medias, que es justo lo que la atomicidad de esta función evita.
--
-- Los parámetros nuevos van al final y todos con valor por omisión, así que las
-- llamadas existentes —que pasan argumentos con nombre— siguen funcionando sin
-- cambios.
--
-- Hay que hacer DROP y no `create or replace`: cambiar la lista de argumentos
-- crearía una **sobrecarga** en vez de reemplazar, y con dos versiones conviviendo
-- una llamada por nombre podría resolverse a la equivocada.
drop function if exists crear_reserva(
  uuid, uuid, uuid, date, date, integer, numeric, numeric,
  text, text, estado_reserva, uuid, uuid, text
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
  -- ── Desglose de ocupación (paso 6) ──
  -- `p_adultos` en null significa «no me pasaron el desglose»: se asume que todos
  -- los huéspedes son adultos, que es exactamente lo que el sistema suponía antes.
  p_adultos        int             default null,
  p_menores        int             default 0,
  p_bebes          int             default 0,
  p_camas_extra    int             default 0,
  p_cunas          int             default 0,
  p_no_mover       boolean         default false,
  -- ── Datos comerciales (paso 6) ──
  p_plan           text            default 'desayuno',
  p_garantia       text            default 'sin_garantia',
  p_segmento       text            default 'particular',
  p_voucher        text            default '',
  p_contrato_id    uuid            default null,
  p_descuento_pct  numeric         default 0,
  p_subtotal       numeric         default 0,
  p_total_neto     numeric         default 0,
  p_iva            numeric         default 0
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
    descuento_pct, subtotal, total_neto, iva
  ) values (
    p_huesped_id, p_estado, p_canal, p_tarifa_tipo, p_promocion_id, p_politica_id,
    p_total, p_notas, auth.uid(),
    p_plan, p_garantia, p_segmento, p_voucher, p_contrato_id,
    p_descuento_pct, p_subtotal, p_total_neto, p_iva
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
  'Alta atómica reserva + estadía; la exclusión anti-overbooking aborta la operación completa si hay solape. Deriva `estadias.huespedes` del desglose de adultos y menores cuando se lo pasan.';

grant execute on function crear_reserva(
  uuid, uuid, uuid, date, date, integer, numeric, numeric,
  text, text, estado_reserva, uuid, uuid, text,
  integer, integer, integer, integer, integer, boolean,
  text, text, text, text, uuid, numeric, numeric, numeric, numeric
) to authenticated, service_role;
