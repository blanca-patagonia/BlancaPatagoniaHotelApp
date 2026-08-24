-- 0058 · Exención de IVA al turista del exterior (RG 3971 / Decreto 1043/2016)
--
-- Pedido del cliente (relevamiento del 15/08/2026): «a los extranjeros no se les
-- cobra IVA». En WinPAX eso era un departamento aparte llamado «Alojamiento
-- Extranjero» y dos precios lado a lado en el listado.
--
-- ── Lo que la norma exige, y que es lo que más se equivoca a mano ───────────
--
-- La exención NO depende de la nacionalidad ni del pasaporte. Exige **las dos
-- condiciones juntas**:
--
--   (a) el huésped es residente en el exterior, y
--   (b) el pago se hace DESDE el exterior — tarjeta emitida fuera del país o
--       transferencia del exterior.
--
-- Un extranjero que paga en efectivo en pesos **no está exento**. Por eso acá no
-- hay ninguna columna «exento» que alguien pueda tildar: la exención se *deriva*
-- de los dos datos de abajo y no se puede forzar desde la pantalla. Es la
-- diferencia entre impedir el error y advertirlo.
--
-- ── Alcance ─────────────────────────────────────────────────────────────────
--
-- La exención alcanza al **alojamiento y al desayuno incluido en la tarifa**. NO
-- alcanza al frigobar, las excursiones ni los traslados: ésos siguen gravados
-- aunque el huésped esté exento por el alojamiento. De ahí la columna
-- `facturas.exento`, que separa la parte no gravada dentro del neto.
--
-- Decisiones y su porqué: ADR 0024.

-- ── 1. Residencia: atributo del HUÉSPED ─────────────────────────────────────
-- Va en `huespedes` y no en `reservas` porque es una propiedad de la persona:
-- quien vive en el exterior lo sigue haciendo entre una estadía y la siguiente.
-- Lo que sí cambia por reserva es cómo pagó, que es la columna del punto 2.

alter table huespedes
  add column residente_exterior boolean not null default false;

comment on column huespedes.residente_exterior is
  'Residente en el exterior a los efectos de la RG 3971. Es UNA de las dos condiciones de la exención; por sí sola no exime. La nacionalidad (`nacionalidad`) es un dato distinto y NO determina la exención.';

-- ── 2. Origen del pago: atributo de la RESERVA ──────────────────────────────
-- Tres estados y no dos, a propósito:
--   null    → todavía no se sabe (la reserva se cargó, nadie pagó aún)
--   true    → tarjeta emitida en el exterior o transferencia del exterior
--   false   → efectivo, tarjeta local o transferencia local
--
-- El `null` importa: cotizar como exento algo que después se paga en efectivo
-- deja un total que no cierra. Mientras no se sepa, la reserva NO está exenta.

alter table reservas
  add column pago_desde_exterior boolean;

comment on column reservas.pago_desde_exterior is
  'Origen del pago para la RG 3971. `null` = todavía no se sabe, y en ese caso NO hay exención. Es la segunda condición, junto con `huespedes.residente_exterior`.';

-- ── 3. La factura: separar lo exento sin romper `neto + iva = total` ────────
--
-- El sistema garantiza en todos lados que `neto + iva = total`, y hay tests que
-- lo fijan. Un comprobante con parte exenta y parte gravada podría romperlo si
-- se agregara el monto exento como un tercer sumando.
--
-- Por eso `exento` es un **subconjunto de `neto`**, no un sumando aparte:
--
--     neto  = alojamiento sin IVA + consumos sin IVA   (todo lo no-impositivo)
--     exento = la parte de `neto` que no tributa        (el alojamiento)
--     iva   = impuesto sobre (neto - exento)
--     total = neto + iva                                ← la garantía se mantiene
--
-- Es además la forma en que AFIP lo modela: `ImpNeto` (gravado), `ImpOpEx`
-- (operaciones exentas) e `ImpIVA` viajan por separado en el comprobante
-- electrónico, y el total es la suma de los tres. Acá `neto` los agrupa y
-- `exento` dice cuánto de ese neto corresponde a `ImpOpEx`.

alter table facturas
  add column exento numeric(12, 2) not null default 0,
  add column motivo_exencion text;

comment on column facturas.exento is
  'Parte del `neto` que NO tributa IVA (alojamiento a turista del exterior). Es un subconjunto de `neto`, no un sumando: `neto + iva = total` sigue siendo cierto. Equivale a `ImpOpEx` del comprobante electrónico de AFIP.';

comment on column facturas.motivo_exencion is
  'Fundamento legal de la exención, impreso en el comprobante. Obligatorio cuando `exento > 0`: una factura con parte no gravada tiene que decir por qué.';

-- La parte exenta no puede ser negativa ni mayor que el neto: si lo fuera, el
-- IVA se calcularía sobre una base negativa y el comprobante saldría mal sin
-- que nada fallara.
alter table facturas
  add constraint facturas_exento_dentro_del_neto
  check (exento >= 0 and exento <= neto);

comment on constraint facturas_exento_dentro_del_neto on facturas is
  'La parte exenta es un subconjunto del neto. Sin esto, un `exento` mayor que el neto daría una base imponible negativa.';

-- Una exención sin fundamento escrito no es oponible ante una inspección, y un
-- fundamento sin exención es ruido. Las dos cosas van juntas o no van.
alter table facturas
  add constraint facturas_exencion_fundada
  check ((exento > 0) = (motivo_exencion is not null));

comment on constraint facturas_exencion_fundada on facturas is
  'Si hay monto exento tiene que haber fundamento legal, y viceversa. Mismo patrón que `facturas_cae_completo` de la 0021.';

-- ── 4. Índice para el reporte de operaciones exentas ────────────────────────
-- La declaración jurada de IVA pide el total de operaciones exentas del período.
-- Sin índice eso es un recorrido completo de `facturas` cada vez.

create index facturas_exentas_idx on facturas (emitida_en)
  where exento > 0;

comment on index facturas_exentas_idx is
  'Parcial: solo las facturas con parte exenta. Sirve al total de operaciones exentas del período para la declaración jurada.';

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- Las tres columnas nuevas viven en tablas que ya tienen RLS activado y sus
-- políticas cubren la fila entera, así que heredan el alcance correcto:
-- `huespedes` y `facturas` quedaron restringidas a admin/gerencia/recepcion en
-- la migración 0045, y housekeeping no las lee. No hace falta política nueva y
-- se deja anotado para que quien audite no salga a buscarla.
--
-- Ninguna de las tres expone el precio neto de agencia, así que el ADR 0016
-- no se ve afectado.
