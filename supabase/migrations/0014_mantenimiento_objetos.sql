-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0014 — Mantenimiento y objetos perdidos (Fase 8, gestión interna)
-- Módulos operativos del staff: órdenes de trabajo de mantenimiento y registro de
-- objetos perdidos. No tienen cara al cliente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Mantenimiento ─────────────────────────────────────────────────────────────
create type prioridad_mant as enum ('baja', 'media', 'alta');
create type estado_mant as enum ('pendiente', 'en_proceso', 'resuelta');

create table ordenes_mantenimiento (
  id          uuid primary key default gen_random_uuid(),
  unidad_id   uuid references unidades (id) on delete set null,
  titulo      text not null,
  descripcion text not null default '',
  prioridad   prioridad_mant not null default 'media',
  estado      estado_mant not null default 'pendiente',
  asignada_a  uuid references perfiles (id),
  creada_por  uuid references perfiles (id),
  creada_en   timestamptz not null default now(),
  resuelta_en timestamptz
);
comment on table ordenes_mantenimiento is 'Órdenes de trabajo de mantenimiento por unidad.';
create index on ordenes_mantenimiento (estado);

-- ── Objetos perdidos ──────────────────────────────────────────────────────────
create type estado_objeto as enum ('guardado', 'devuelto');

create table objetos_perdidos (
  id             uuid primary key default gen_random_uuid(),
  descripcion    text not null,
  ubicacion      text not null default '',
  fecha_hallazgo date not null default current_date,
  estado         estado_objeto not null default 'guardado',
  reserva_id     uuid references reservas (id) on delete set null,
  notas          text not null default '',
  creado_por     uuid references perfiles (id),
  creado_en      timestamptz not null default now()
);
comment on table objetos_perdidos is 'Registro de objetos perdidos y su devolución.';

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table ordenes_mantenimiento enable row level security;
alter table objetos_perdidos       enable row level security;

create policy "mant: staff lee" on ordenes_mantenimiento
  for select using (rol_actual() is not null);
create policy "mant: admin/gerencia/housekeeping gestionan" on ordenes_mantenimiento
  for all using (rol_actual() in ('admin', 'gerencia', 'housekeeping'))
  with check (rol_actual() in ('admin', 'gerencia', 'housekeeping'));

create policy "objetos: staff lee" on objetos_perdidos
  for select using (rol_actual() is not null);
create policy "objetos: recepcion+ gestiona" on objetos_perdidos
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));
