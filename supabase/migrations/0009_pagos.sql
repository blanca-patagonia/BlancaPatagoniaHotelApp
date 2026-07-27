-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0009 — Pagos (Fase 3)
-- Registra los pagos de cada reserva: seña, saldo y reembolsos. Soporta pagos
-- manuales (efectivo/transferencia) y pasarelas (MercadoPago/Stripe), estas
-- últimas con `external_id` para idempotencia de webhooks.
-- ─────────────────────────────────────────────────────────────────────────────

create type medio_pago  as enum ('efectivo', 'transferencia', 'tarjeta', 'mercadopago', 'stripe');
create type tipo_pago   as enum ('senia', 'saldo', 'reembolso');
create type estado_pago as enum ('pendiente', 'aprobado', 'rechazado', 'reembolsado');

create table pagos (
  id          uuid primary key default gen_random_uuid(),
  reserva_id  uuid not null references reservas (id) on delete cascade,
  medio       medio_pago  not null default 'efectivo',
  tipo        tipo_pago   not null default 'saldo',
  monto       numeric(12,2) not null check (monto > 0),
  moneda      char(3)     not null default 'USD',
  estado      estado_pago not null default 'aprobado',
  external_id text unique,                    -- idempotencia de la pasarela
  nota        text        not null default '',
  creado_por  uuid references perfiles (id),
  creado_en   timestamptz not null default now()
);
comment on table pagos is
  'Pagos por reserva (seña / saldo / reembolso). external_id da idempotencia a los webhooks.';
create index on pagos (reserva_id);

alter table pagos enable row level security;

create policy "pagos: staff lee" on pagos
  for select using (rol_actual() is not null);
create policy "pagos: recepcion+ gestiona" on pagos
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));
