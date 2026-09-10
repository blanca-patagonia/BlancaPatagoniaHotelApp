-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0092 — Gastos operativos
--
-- Patrón de referencia: el módulo de gastos de Invoice Ninja. `proveedores` ya
-- cubre las facturas formales de terceros (cuentas por pagar), pero el hotel
-- también tiene gastos SIN factura de proveedor: sueldos, servicios, un
-- arreglo de caja chica. Hoy no había dónde cargarlos — «gasto» en
-- `movimientos_externos` (migración 0077) es solo la ETIQUETA que la
-- conciliación bancaria le pone a un movimiento sin contrapartida, no un
-- registro con categoría y responsable.
--
-- Vive bajo el área `conciliacion` que ya existe (`Conciliación y gastos`,
-- `lib/domain/permisos.ts`) en vez de sumar un área nueva de las cinco que pide
-- `AGENTS.md`: el nombre del área ya anunciaba esto, y es la misma gente
-- (admin/gerencia) la que necesita verlo.
-- ─────────────────────────────────────────────────────────────────────────────

create table gastos_operativos (
  id          uuid primary key default gen_random_uuid(),
  categoria   text not null check (categoria in
                ('sueldos', 'servicios', 'mantenimiento', 'impuestos', 'insumos', 'otro')),
  descripcion text not null check (char_length(descripcion) > 0),
  monto       numeric(12,2) not null check (monto > 0),
  moneda      char(3) not null default 'USD',
  fecha       date not null default current_date,
  creado_por  uuid references perfiles (id),
  creado_en   timestamptz not null default now()
);

comment on table gastos_operativos is
  'Gastos del hotel sin factura formal de proveedor: sueldos, servicios, caja chica.';

create index on gastos_operativos (fecha desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Mismo criterio que `movimientos_externos`: es plata que no pasó por una
-- reserva ni por un proveedor con cuenta corriente, y solo admin/gerencia
-- tienen el área `conciliacion`.
alter table gastos_operativos enable row level security;

create policy "gastos_operativos: admin y gerencia gestionan" on gastos_operativos
  for all
  using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));
