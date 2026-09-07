-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0078 — Moneda real en las cuentas corrientes
-- (Bloque C de la auditoría 2026-09, hallazgo P1-3)
--
-- ── El defecto ───────────────────────────────────────────────────────────────
--
-- `movimientos_cuenta` (0012) y `movimientos_proveedor` (0016) tienen desde el
-- primer día una columna `moneda char(3) not null default 'USD'`.
--
-- **Ninguna acción de la aplicación la escribe.** Verificado: los tres únicos
-- `insert` que existen —`registrarMovimiento` en agencias, `registrarMovimiento`
-- en proveedores y `registrarFacturaComision` en canales— pasan `monto` y no
-- pasan `moneda`, así que **todas las filas dicen USD**.
--
-- Y `saldoCuenta` (`lib/domain/cuentas.ts`) suma `monto` sin mirar la moneda.
--
-- Es exactamente el bug que la migración 0067 arregló en `pagos`, acá sin ningún
-- `check` que lo frene. El proveedor local factura en pesos: quien carga la
-- factura de la lavandería escribe «185000» porque es lo que dice el papel, y el
-- sistema la suma como **USD 185.000** al saldo del proveedor. El aging report,
-- el KPI de deuda del panel y el portal del socio quedan todos mal por el mismo
-- número.
--
-- ── La regla, la misma que la 0067 ───────────────────────────────────────────
--
--   · `monto`        SIEMPRE en USD. Es lo único que entra al saldo.
--   · `moneda`       la moneda en la que se pactó/pagó de verdad.
--   · `monto_origen` cuánto fue en esa moneda.
--   · `cotizacion`   a qué tipo de cambio se convirtió, congelado ese día.
--
-- ⚠️ La columna NO se llama `monto_cobrado` como en `pagos`, y es a propósito:
-- acá la mitad de los movimientos son plata que el hotel **paga**, no que cobra.
-- «Cobrado» en la factura de un proveedor se lee al revés de lo que es.
--
-- ── Lo que esta migración NO puede hacer ─────────────────────────────────────
--
-- Corregir el pasado. Las filas que ya están dicen `USD` y no hay forma de saber
-- desde acá cuáles se cargaron pensando en pesos: el dato de la moneda real
-- nunca existió. Se dejan como están —inventar una conversión retroactiva sería
-- peor— y `docs/bitacora.md` anota que las cuentas corrientes anteriores a esta
-- fecha hay que revisarlas contra el papel.
-- ─────────────────────────────────────────────────────────────────────────────

/* ───────────────────────────────── 1. cuentas de agencias / empresas ────── */

alter table movimientos_cuenta
  add column monto_origen numeric(12,2),
  add column cotizacion   numeric(14,4);

comment on column movimientos_cuenta.monto is
  'SIEMPRE en USD. Es lo único que suma saldoCuenta. Si el movimiento fue en otra moneda, el importe real va en monto_origen.';
comment on column movimientos_cuenta.moneda is
  'Moneda en la que se pactó el movimiento. USD cuando fue en dólares.';
comment on column movimientos_cuenta.monto_origen is
  'Importe en `moneda`. Es lo que dice el comprobante que la agencia tiene en la mano.';
comment on column movimientos_cuenta.cotizacion is
  'Tipo de cambio USD → moneda del día del movimiento. Se congela: la cotización de hoy no explica un cargo del mes pasado.';

alter table movimientos_cuenta
  add constraint movimientos_cuenta_moneda_conocida
  check (moneda in ('USD', 'ARS', 'BRL', 'EUR'));

alter table movimientos_cuenta
  add constraint movimientos_cuenta_origen_positivo
  check (monto_origen is null or monto_origen > 0);

alter table movimientos_cuenta
  add constraint movimientos_cuenta_cotizacion_positiva
  check (cotizacion is null or cotizacion > 0);

-- La coherencia, igual que `pagos_conversion_coherente` (0067): en USD el
-- detalle no puede contradecir al monto, y fuera del USD el detalle es
-- obligatorio o el importe en dólares queda sin explicación.
alter table movimientos_cuenta
  add constraint movimientos_cuenta_conversion_coherente
  check (
    case
      when moneda = 'USD'
        then (monto_origen is null or monto_origen = monto)
         and (cotizacion is null or cotizacion = 1)
      else monto_origen is not null and cotizacion is not null
    end
  );

comment on constraint movimientos_cuenta_conversion_coherente on movimientos_cuenta is
  'Un movimiento en pesos sin cotización no se puede auditar: el importe en USD que movió el saldo quedaría sin justificación.';

/* ─────────────────────────────────────── 2. cuentas por pagar ───────────── */

alter table movimientos_proveedor
  add column monto_origen numeric(12,2),
  add column cotizacion   numeric(14,4);

comment on column movimientos_proveedor.monto is
  'SIEMPRE en USD. Es lo que entra al saldo y al aging. El importe del comprobante del proveedor va en monto_origen.';
comment on column movimientos_proveedor.moneda is
  'Moneda del comprobante. El proveedor local factura en ARS; el software del exterior, en USD.';
comment on column movimientos_proveedor.monto_origen is
  'Importe en `moneda`, tal como figura en la factura del proveedor. Es el número contra el que se concilia el papel.';
comment on column movimientos_proveedor.cotizacion is
  'Tipo de cambio USD → moneda del día del comprobante, congelado.';

alter table movimientos_proveedor
  add constraint movimientos_proveedor_moneda_conocida
  check (moneda in ('USD', 'ARS', 'BRL', 'EUR'));

alter table movimientos_proveedor
  add constraint movimientos_proveedor_origen_positivo
  check (monto_origen is null or monto_origen > 0);

alter table movimientos_proveedor
  add constraint movimientos_proveedor_cotizacion_positiva
  check (cotizacion is null or cotizacion > 0);

alter table movimientos_proveedor
  add constraint movimientos_proveedor_conversion_coherente
  check (
    case
      when moneda = 'USD'
        then (monto_origen is null or monto_origen = monto)
         and (cotizacion is null or cotizacion = 1)
      else monto_origen is not null and cotizacion is not null
    end
  );

comment on constraint movimientos_proveedor_conversion_coherente on movimientos_proveedor is
  'Misma regla que en pagos (0067): fuera del USD, sin cotización el saldo en dólares no se puede reconstruir.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Un cargo en pesos sin cotización tiene que ser rechazado:
--   insert into movimientos_proveedor (proveedor_id, tipo, monto, moneda)
--   select id, 'cargo', 100, 'ARS' from proveedores limit 1;   -- 23514
--
--   -- Y con el detalle completo, entra:
--   insert into movimientos_proveedor
--     (proveedor_id, tipo, monto, moneda, monto_origen, cotizacion)
--   select id, 'cargo', 100, 'ARS', 148000, 1480 from proveedores limit 1;  -- ok
--
--   -- Nadie puede declarar una moneda que el sistema no sabe cotizar:
--   ... moneda = 'CLP'  -- 23514
