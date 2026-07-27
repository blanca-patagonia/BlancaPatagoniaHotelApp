-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0002 — Inventario: tipos de unidad y unidades físicas (Fase 1)
-- Define las categorías de alojamiento (Hostería / Cabañas) y las unidades
-- físicas con su estado de housekeeping.
-- ─────────────────────────────────────────────────────────────────────────────

-- Requerida por las restricciones de exclusión (temporadas y ocupación).
create extension if not exists btree_gist;

-- Categoría comercial de la unidad.
create type categoria_unidad as enum ('hosteria', 'cabana');

-- Estado de housekeeping / gobernanta.
create type estado_hk as enum ('limpia', 'sucia', 'inspeccionada', 'bloqueada');

-- ── Tipos de unidad ───────────────────────────────────────────────────────────
create table tipos_unidad (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,
  nombre        text not null,
  categoria     categoria_unidad not null,
  capacidad_max int not null check (capacidad_max > 0),
  descripcion   text not null default '',
  amenities     jsonb not null default '[]'::jsonb,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);
comment on table tipos_unidad is
  'Categorías de alojamiento (Hostería y Cabañas) con capacidad y amenities.';

-- ── Unidades físicas ──────────────────────────────────────────────────────────
create table unidades (
  id             uuid primary key default gen_random_uuid(),
  tipo_unidad_id uuid not null references tipos_unidad (id) on delete restrict,
  nombre         text not null,
  estado         estado_hk not null default 'limpia',
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);
comment on table unidades is
  'Unidad física (habitación o cabaña) y su estado de housekeeping.';
create index on unidades (tipo_unidad_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table tipos_unidad enable row level security;
alter table unidades     enable row level security;

-- Tipos: el portal público lee los activos; el staff ve todo.
create policy "tipos: lectura publica de activos o staff" on tipos_unidad
  for select using (activo or rol_actual() is not null);
create policy "tipos: admin/gerencia gestionan" on tipos_unidad
  for all using (rol_actual() in ('admin','gerencia'))
  with check (rol_actual() in ('admin','gerencia'));

-- Unidades: solo staff las ve (el público consulta disponibilidad agregada).
create policy "unidades: lectura staff" on unidades
  for select using (rol_actual() is not null);
create policy "unidades: admin/gerencia gestionan" on unidades
  for all using (rol_actual() in ('admin','gerencia'))
  with check (rol_actual() in ('admin','gerencia'));
-- Housekeeping puede cambiar el estado de las unidades.
create policy "unidades: housekeeping actualiza" on unidades
  for update using (rol_actual() = 'housekeeping')
  with check (rol_actual() = 'housekeeping');
