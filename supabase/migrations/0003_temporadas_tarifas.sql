-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0003 — Temporadas, rangos de fecha y tarifas (Fase 1)
-- Las tarifas del Anexo A (Tarifario 2025/2026) se cargan por
-- (tipo de unidad × temporada). Se distingue precio neto (agencia) de rack
-- (mostrador). Los montos son SIN IVA ("IVA discriminado").
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Temporadas ────────────────────────────────────────────────────────────────
create table temporadas (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,          -- 'baja' | 'media' | 'alta'
  nombre    text not null,
  orden     int  not null default 0,
  creado_en timestamptz not null default now()
);
comment on table temporadas is 'Temporadas tarifarias (baja, media, alta).';

-- Cada temporada puede tener varios rangos de fecha (ver Tarifario). Una fecha
-- pertenece a una sola temporada: la restricción de exclusión impide solapes.
create table temporada_rangos (
  id           uuid primary key default gen_random_uuid(),
  temporada_id uuid not null references temporadas (id) on delete cascade,
  rango        daterange not null,
  constraint temporada_rangos_sin_solape exclude using gist (rango with &&)
);
comment on table temporada_rangos is
  'Rangos de fecha de cada temporada; no pueden solaparse entre sí.';
create index on temporada_rangos (temporada_id);

-- Temporada vigente para una fecha dada (usada por el motor de precios).
create or replace function temporada_en(f date)
returns uuid language sql stable as $$
  select temporada_id from temporada_rangos where rango @> f limit 1;
$$;

-- ── Tarifas ───────────────────────────────────────────────────────────────────
create table tarifas (
  id             uuid primary key default gen_random_uuid(),
  tipo_unidad_id uuid not null references tipos_unidad (id) on delete cascade,
  temporada_id   uuid not null references temporadas (id) on delete cascade,
  precio_neto    numeric(10,2) not null check (precio_neto >= 0),  -- agencia
  precio_rack    numeric(10,2) not null check (precio_rack >= 0),  -- mostrador
  moneda         char(3)       not null default 'USD',
  iva_pct        numeric(5,2)  not null default 21,
  vigente        boolean       not null default true,
  unique (tipo_unidad_id, temporada_id)
);
comment on table tarifas is
  'Precio por (tipo de unidad × temporada). Neto = agencia, Rack = mostrador. Montos sin IVA.';

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Precios y temporadas son públicos (el portal los muestra). La escritura es
-- exclusiva de administración.
alter table temporadas       enable row level security;
alter table temporada_rangos enable row level security;
alter table tarifas          enable row level security;

create policy "temporadas: lectura publica" on temporadas
  for select using (true);
create policy "temporadas: admin/gerencia gestionan" on temporadas
  for all using (rol_actual() in ('admin','gerencia'))
  with check (rol_actual() in ('admin','gerencia'));

create policy "temporada_rangos: lectura publica" on temporada_rangos
  for select using (true);
create policy "temporada_rangos: admin/gerencia gestionan" on temporada_rangos
  for all using (rol_actual() in ('admin','gerencia'))
  with check (rol_actual() in ('admin','gerencia'));

create policy "tarifas: lectura publica" on tarifas
  for select using (true);
create policy "tarifas: admin/gerencia gestionan" on tarifas
  for all using (rol_actual() in ('admin','gerencia'))
  with check (rol_actual() in ('admin','gerencia'));
