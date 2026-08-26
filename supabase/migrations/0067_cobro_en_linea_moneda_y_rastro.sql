-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0067 — Cobro en línea: moneda del cobro y rastro de la tarjeta
--
-- El hotel es internacional: el huésped de afuera paga con una tarjeta de
-- crédito internacional en dólares, y el de acá paga en pesos con MercadoPago,
-- billetera virtual, débito o efectivo en Rapipago. Son dos monedas distintas
-- entrando a la misma reserva.
--
-- El problema que resuelve esta migración es de plata, no de comodidad.
-- `resumenPagos` (lib/domain/pagos.ts) suma `pagos.monto` para decidir si la
-- reserva está saldada, y lo hace **sin mirar la moneda**. Con una pasarela
-- cobrando en pesos, un pago de ARS 350.000 se sumaba como si fueran USD
-- 350.000: la reserva quedaba saldada al instante y el huésped se iba sin pagar.
--
-- La regla que fija esta migración, y que sostienen los `check` de abajo:
--
--   · `monto`         SIEMPRE en USD. Es lo único que salda la reserva.
--   · `moneda`        la moneda que de verdad pasó por la pasarela.
--   · `monto_cobrado` cuánto se cobró en esa moneda.
--   · `cotizacion`    a qué tipo de cambio se convirtió.
--
-- Así el estado de cuenta cierra en USD y el comprobante puede mostrar lo que
-- el huésped vio en su resumen de tarjeta, que es lo que va a reclamar si no
-- coincide.
--
-- La segunda parte agrega el rastro del cobro con tarjeta en el mostrador
-- (cupón, últimos 4, marca). Hoy `medio = 'tarjeta'` es indistinguible de
-- efectivo: no queda con qué conciliar contra la liquidación del posnet.
--
-- ⚠️ Nada de lo que se agrega acá puede contener un número de tarjeta. Los
-- `check` del final lo impiden en la base, no en el código (ADR 0025).
-- ─────────────────────────────────────────────────────────────────────────────

/* ─────────────────────────────────────── 1. moneda real del cobro ──────── */

alter table pagos
  add column monto_cobrado numeric(12,2),
  add column cotizacion    numeric(14,4);

comment on column pagos.monto is
  'SIEMPRE en USD. Es el único importe que salda la reserva (resumenPagos). Si la pasarela cobró en otra moneda, el importe cobrado va en monto_cobrado.';
comment on column pagos.moneda is
  'Moneda que efectivamente pasó por la pasarela o por la caja. USD cuando el cobro fue en dólares.';
comment on column pagos.monto_cobrado is
  'Importe cobrado en `moneda`. Es lo que el huésped ve en su resumen de tarjeta; sirve para conciliar contra la liquidación de la pasarela.';
comment on column pagos.cotizacion is
  'Tipo de cambio USD → moneda aplicado al cobrar. Se congela en el momento del cobro: la cotización de hoy no sirve para explicar un cobro de la semana pasada.';

-- Las monedas que el sistema sabe cotizar (lib/domain/divisas.ts) más el USD
-- base. Una moneda fuera de esta lista no se puede convertir, así que el saldo
-- en USD sería inventado.
alter table pagos
  add constraint pagos_moneda_conocida
  check (moneda in ('USD', 'ARS', 'BRL', 'EUR'));

alter table pagos
  add constraint pagos_monto_cobrado_positivo
  check (monto_cobrado is null or monto_cobrado > 0);

alter table pagos
  add constraint pagos_cotizacion_positiva
  check (cotizacion is null or cotizacion > 0);

-- La coherencia entre las cuatro columnas, en la base.
--
-- · En USD no hay conversión: si viene el detalle, tiene que ser el mismo
--   importe y cotización 1. Un `monto_cobrado` distinto del `monto` en USD
--   significaría que se cobró de más o de menos sin que nadie lo note.
-- · Fuera del USD, el detalle es obligatorio: un pago en pesos sin cotización
--   no se puede auditar —no hay forma de reconstruir de dónde salió el importe
--   en dólares que saldó la reserva—.
alter table pagos
  add constraint pagos_conversion_coherente
  check (
    case
      when moneda = 'USD'
        then (monto_cobrado is null or monto_cobrado = monto)
         and (cotizacion is null or cotizacion = 1)
      else monto_cobrado is not null and cotizacion is not null
    end
  );

comment on constraint pagos_conversion_coherente on pagos is
  'Un pago en moneda extranjera sin cotización no se puede auditar: el importe en USD que saldó la reserva quedaría sin explicación. En USD, el detalle no puede contradecir al monto.';

/* ────────────────────────────── 2. rastro del cobro con tarjeta ────────── */

-- Para conciliar contra la liquidación del posnet hace falta el cupón. Hoy un
-- cobro con tarjeta se registra igual que uno en efectivo, así que cuando la
-- liquidación no cierra no hay por dónde empezar a buscar.
alter table pagos
  add column cupon         text,
  add column ultimos4      char(4),
  add column tarjeta_marca text;

comment on column pagos.cupon is
  'Número de cupón o de autorización que imprime la terminal. Es el dato con el que se concilia contra la liquidación del posnet. NO es un número de tarjeta.';
comment on column pagos.ultimos4 is
  'Últimos cuatro dígitos. PCI-DSS los permite mostrar y guardar; cuatro dígitos no identifican una tarjeta.';
comment on column pagos.tarjeta_marca is
  'Visa, Mastercard, Amex… Sirve para que el huésped reconozca cuál tarjeta usó.';

/* ─────────────────────────────── 3. el link de pago que se reenvía ─────── */

-- Cuando recepción genera un link de pago, el pago nace `pendiente` con su
-- `external_id`. Guardar la URL permite volver a mandarla sin generar otra
-- —dos links vivos por el mismo saldo terminan en un cobro doble— y saber
-- cuándo dejó de servir.
alter table pagos
  add column url_pago text,
  add column vence_en timestamptz;

comment on column pagos.url_pago is
  'URL de la pasarela para este pago. Se guarda para poder REENVIAR el mismo link: generar uno nuevo por el mismo saldo deja dos vivos y habilita el cobro doble.';
comment on column pagos.vence_en is
  'Hasta cuándo sirve el link. Un link sin vencimiento cobra una seña seis meses después, cuando la reserva ya se canceló.';

/* ──────────────────────────── 4. las barreras PCI-DSS (ADR 0025) ───────── */

-- Mismo criterio que la 0059 sobre `reservas`: la barrera que de verdad impide
-- guardar un PAN es de la base. Un comentario se deja de leer; un `check` no.
--
-- Un PAN son 13 a 19 dígitos seguidos. `ultimos4` acepta exactamente cuatro, y
-- el cupón y la marca no pueden traer una tirada larga de dígitos.

alter table pagos
  add constraint pagos_ultimos4_son_4_digitos
  check (ultimos4 is null or ultimos4 ~ '^[0-9]{4}$');

alter table pagos
  add constraint pagos_cupon_no_parece_pan
  check (cupon is null or cupon !~ '[0-9]{12,}');

comment on constraint pagos_cupon_no_parece_pan on pagos is
  'Impide que alguien pegue el número de la tarjeta en el campo del cupón. Un cupón de posnet tiene 6 a 8 dígitos; un PAN tiene 13 o más. Sostiene el alcance SAQ-A cuando el comentario ya no se lee (ADR 0025).';

alter table pagos
  add constraint pagos_marca_no_parece_pan
  check (tarjeta_marca is null or tarjeta_marca !~ '[0-9]{12,}');

alter table pagos
  add constraint pagos_nota_sin_pan
  check (nota !~ '[0-9]{12,}');

comment on constraint pagos_nota_sin_pan on pagos is
  'La nota es texto libre que escribe recepción. Es el lugar más probable donde alguien anote «tarjeta 4507...» de buena fe, y por eso también se bloquea.';

/* ───────────────────────────────────────────────── 5. índices ──────────── */

-- El webhook busca por `external_id` en cada evento (avanzarEstadoDelPago) y la
-- restricción UNIQUE ya lo cubre. Lo que falta es el camino de la conciliación:
-- «qué links de pago siguen pendientes» y «qué venció».
create index pagos_pendientes_idx
  on pagos (estado, vence_en)
  where estado = 'pendiente';

comment on index pagos_pendientes_idx is
  'Links de pago sin resolver. Es la consulta del cierre de caja y la del vencimiento de links.';
