-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0016 — Proveedores, asignación de mucamas y avisos (Fase 8)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Proveedores (cuentas por pagar) ───────────────────────────────────────────
-- Reutiliza tipo_movimiento: 'cargo' = factura del proveedor, 'pago' = pago nuestro.
create table proveedores (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  rubro     text,
  cuit      text,
  email     text,
  telefono  text,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);
comment on table proveedores is 'Proveedores con cuenta corriente (cuentas por pagar).';

create table movimientos_proveedor (
  id           uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores (id) on delete cascade,
  tipo         tipo_movimiento not null,       -- cargo = factura, pago = pago
  monto        numeric(12,2) not null check (monto >= 0),
  moneda       char(3) not null default 'USD',
  concepto     text not null default '',
  fecha        date not null default current_date,
  creado_por   uuid references perfiles (id),
  creado_en    timestamptz not null default now()
);
create index on movimientos_proveedor (proveedor_id);

-- ── Asignación de mucamas ─────────────────────────────────────────────────────
alter table unidades add column asignada_a uuid references perfiles (id);
comment on column unidades.asignada_a is 'Mucama/o (perfil housekeeping) asignada a la unidad.';

-- ── Avisos internos ───────────────────────────────────────────────────────────
create table avisos (
  id        uuid primary key default gen_random_uuid(),
  mensaje   text not null,
  autor_id  uuid references perfiles (id),
  creado_en timestamptz not null default now()
);
comment on table avisos is 'Mensajería interna: avisos entre el personal.';
create index on avisos (creado_en desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table proveedores          enable row level security;
alter table movimientos_proveedor enable row level security;
alter table avisos               enable row level security;

create policy "proveedores: staff lee" on proveedores
  for select using (rol_actual() is not null);
create policy "proveedores: admin/gerencia gestionan" on proveedores
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "mov_prov: staff lee" on movimientos_proveedor
  for select using (rol_actual() is not null);
create policy "mov_prov: admin/gerencia gestionan" on movimientos_proveedor
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "avisos: staff lee" on avisos
  for select using (rol_actual() is not null);
create policy "avisos: staff publica" on avisos
  for insert with check (rol_actual() is not null);
create policy "avisos: autor o admin borra" on avisos
  for delete using (autor_id = auth.uid() or rol_actual() = 'admin');

-- El staff puede ver los nombres de sus colegas (para autor de avisos y
-- asignaciones de mantenimiento / mucamas). No expone datos sensibles.
create policy "perfiles: staff ve nombres" on perfiles
  for select using (rol_actual() is not null);
