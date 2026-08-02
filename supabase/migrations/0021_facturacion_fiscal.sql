-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0021 — Facturación electrónica argentina (Fase 11)
--
-- Completa el modelo fiscal que la migración 0010 había dejado esbozado (las
-- columnas `cae`, `cae_vto`, `punto_venta` y `tipo_comprobante` estaban
-- reservadas). Agrega la condición frente al IVA de emisor y receptor, el
-- desglose del impuesto y la numeración oficial.
--
-- ⚠️ No hay conexión con AFIP/ARCA: el CAE lo emite un proveedor simulado
-- (`FacturacionElectronicaProvider`). Ver ADR 0012.
-- ─────────────────────────────────────────────────────────────────────────────

create type condicion_iva as enum (
  'responsable_inscripto',
  'monotributo',
  'exento',
  'consumidor_final'
);

create type tipo_comprobante as enum ('A', 'B', 'C');

-- ── Condición fiscal de las contrapartes ─────────────────────────────────────
-- Determina la letra del comprobante que corresponde emitirles.
alter table agencias  add column condicion_iva condicion_iva not null default 'responsable_inscripto';
alter table huespedes add column condicion_iva condicion_iva not null default 'consumidor_final';

comment on column agencias.condicion_iva is
  'Condición frente al IVA; con responsable inscripto corresponde factura A.';
comment on column huespedes.condicion_iva is
  'Condición frente al IVA del huésped; por defecto consumidor final (factura B).';

-- ── Datos fiscales del comprobante ───────────────────────────────────────────
-- `tipo_comprobante` era `text`: se convierte al enum (las filas existentes lo
-- tienen en null, así que el cast es seguro).
alter table facturas
  alter column tipo_comprobante type tipo_comprobante using tipo_comprobante::tipo_comprobante;

alter table facturas
  add column neto           numeric(12,2),
  add column iva            numeric(12,2),
  add column alicuota_iva   numeric(5,2) not null default 21,
  add column condicion_iva_receptor condicion_iva,
  add column cuit_receptor   text,
  add column numero_fiscal   text,
  add column cae_solicitado_en timestamptz;

comment on column facturas.neto is 'Importe sin IVA (total / (1 + alícuota)).';
comment on column facturas.iva is 'Impuesto discriminado; en comprobantes B y C es informativo.';
comment on column facturas.numero_fiscal is 'Número oficial PPPP-NNNNNNNN que asigna el punto de venta.';
comment on column facturas.cae_solicitado_en is 'Momento en que se pidió el CAE al proveedor.';

-- Coherencia: si hay CAE tiene que haber vencimiento, y viceversa.
alter table facturas add constraint facturas_cae_completo
  check ((cae is null) = (cae_vto is null));

-- El número fiscal, cuando existe, no puede repetirse.
create unique index facturas_numero_fiscal_idx on facturas (numero_fiscal)
  where numero_fiscal is not null;
