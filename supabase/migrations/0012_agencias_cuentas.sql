-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0012 — Cuentas corrientes de agencias / empresas (Fase 8)
-- Agencias y empresas con cuenta corriente: se les carga el importe de sus
-- reservas y se registran sus pagos; el saldo = cargos − pagos.
-- ─────────────────────────────────────────────────────────────────────────────

create type tipo_cuenta as enum ('agencia', 'empresa');
create type tipo_movimiento as enum ('cargo', 'pago');

create table agencias (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  tipo          tipo_cuenta not null default 'agencia',
  cuit          text,
  email         text,
  telefono      text,
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);
comment on table agencias is 'Agencias y empresas con cuenta corriente.';

alter table reservas add column agencia_id uuid references agencias (id);

create table movimientos_cuenta (
  id         uuid primary key default gen_random_uuid(),
  agencia_id uuid not null references agencias (id) on delete cascade,
  tipo       tipo_movimiento not null,
  monto      numeric(12,2) not null check (monto >= 0),
  moneda     char(3) not null default 'USD',
  reserva_id uuid references reservas (id) on delete set null,
  concepto   text not null default '',
  fecha      date not null default current_date,
  creado_por uuid references perfiles (id),
  creado_en  timestamptz not null default now()
);
comment on table movimientos_cuenta is
  'Movimientos de la cuenta corriente: cargo (debe) / pago (haber). Saldo = cargos − pagos.';
create index on movimientos_cuenta (agencia_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table agencias           enable row level security;
alter table movimientos_cuenta enable row level security;

create policy "agencias: staff lee" on agencias
  for select using (rol_actual() is not null);
create policy "agencias: admin/gerencia gestionan" on agencias
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "movimientos: staff lee" on movimientos_cuenta
  for select using (rol_actual() is not null);
create policy "movimientos: recepcion+ gestiona" on movimientos_cuenta
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));
