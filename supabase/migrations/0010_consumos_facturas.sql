-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0010 — Consumos y facturación interna (Fase 5)
-- Catálogo de productos/servicios (frigobar, desayuno, excursiones, traslados),
-- consumos cargados a una reserva, y facturas internas (con columnas AFIP
-- preparadas para la facturación electrónica de la Fase 8).
-- ─────────────────────────────────────────────────────────────────────────────

create type categoria_producto as enum
  ('desayuno', 'frigobar', 'excursion', 'traslado', 'otro');

create table productos_servicios (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,
  nombre    text not null,
  categoria categoria_producto not null default 'otro',
  precio    numeric(10,2) not null check (precio >= 0),
  moneda    char(3) not null default 'USD',
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);
comment on table productos_servicios is
  'Catálogo de consumos y servicios extra (frigobar, desayuno, excursiones, traslados).';

create table consumos (
  id             uuid primary key default gen_random_uuid(),
  reserva_id     uuid not null references reservas (id) on delete cascade,
  producto_id    uuid not null references productos_servicios (id) on delete restrict,
  cantidad       int not null default 1 check (cantidad > 0),
  precio_unitario numeric(10,2) not null check (precio_unitario >= 0), -- snapshot
  fecha          date not null default current_date,
  cargado_por    uuid references perfiles (id),
  creado_en      timestamptz not null default now()
);
comment on table consumos is 'Consumos cargados a la cuenta de una reserva.';
create index on consumos (reserva_id);

create table facturas (
  id               uuid primary key default gen_random_uuid(),
  reserva_id       uuid not null references reservas (id) on delete restrict,
  numero           text not null unique
                     default ('FAC-' || to_char(now(), 'YYYYMMDD') || '-' ||
                              upper(substr(md5(random()::text), 1, 4))),
  total            numeric(12,2) not null,
  moneda           char(3) not null default 'USD',
  pdf_url          text,
  -- Columnas AFIP (se completan en la Fase 8 — facturación electrónica).
  cae              text,
  cae_vto          date,
  punto_venta      int,
  tipo_comprobante text,
  emitida_por      uuid references perfiles (id),
  emitida_en       timestamptz not null default now()
);
comment on table facturas is
  'Comprobante interno por reserva. Columnas AFIP (CAE) preparadas para la Fase 8.';
create index on facturas (reserva_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table productos_servicios enable row level security;
alter table consumos            enable row level security;
alter table facturas            enable row level security;

create policy "productos: lectura staff" on productos_servicios
  for select using (rol_actual() is not null);
create policy "productos: admin/gerencia gestionan" on productos_servicios
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "consumos: staff lee" on consumos
  for select using (rol_actual() is not null);
create policy "consumos: recepcion+ gestiona" on consumos
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "facturas: staff lee" on facturas
  for select using (rol_actual() is not null);
create policy "facturas: recepcion+ gestiona" on facturas
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

-- ── Catálogo inicial (datos de referencia) ────────────────────────────────────
insert into productos_servicios (codigo, nombre, categoria, precio) values
  ('DES-EXTRA',   'Desayuno adicional',           'desayuno',   12),
  ('FRI-AGUA',    'Agua mineral (frigobar)',      'frigobar',    3),
  ('FRI-GASE',    'Gaseosa (frigobar)',           'frigobar',    4),
  ('FRI-CERV',    'Cerveza artesanal (frigobar)', 'frigobar',    7),
  ('FRI-VINO',    'Vino patagónico (frigobar)',   'frigobar',   18),
  ('EXC-PMCLAS',  'Perito Moreno clásico',        'excursion',  90),
  ('EXC-MINITRK', 'Minitrekking Perito Moreno',   'excursion', 180),
  ('EXC-TODOGLA', 'Todo Glaciares',               'excursion', 250),
  ('TRA-AERO',    'Traslado aeropuerto',          'traslado',   35);
