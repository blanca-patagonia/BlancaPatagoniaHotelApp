-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0004 — Promociones, políticas de cancelación y huéspedes (Fase 1)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Políticas de cancelación ──────────────────────────────────────────────────
-- `reglas` es una lista ordenable de umbrales: [{ "desde_dias": n, "cargo": ... }].
-- Se aplica la primera regla cuyo `desde_dias` <= días de anticipación.
create table politicas_cancelacion (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique,
  nombre       text not null,
  reembolsable boolean not null default true,
  reglas       jsonb   not null default '[]'::jsonb,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now()
);
comment on table politicas_cancelacion is
  'Reglas de cancelación: umbral en días antes del check-in → cargo aplicable.';

-- ── Promociones ───────────────────────────────────────────────────────────────
create table promociones (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre         text not null,
  tipo           text not null check (tipo in ('porcentaje','monto','paquete')),
  valor          numeric(10,2) not null default 0,
  condiciones    jsonb   not null default '{}'::jsonb,  -- {min_noches, anticipacion_dias, categoria}
  vigencia_desde date,
  vigencia_hasta date,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);
comment on table promociones is
  'Reglas de descuento y paquetes (alojamiento + comidas / excursiones / traslados).';

-- ── Huéspedes ─────────────────────────────────────────────────────────────────
create table huespedes (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  apellido     text not null,
  doc_tipo     text not null default 'DNI',
  doc_numero   text not null default '',
  email        text,
  telefono     text,
  nacionalidad text,
  notas        text not null default '',
  creado_en    timestamptz not null default now()
);
comment on table huespedes is 'Datos de los huéspedes; base para el historial.';
create index on huespedes (apellido, nombre);
create index on huespedes (email);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table politicas_cancelacion enable row level security;
alter table promociones           enable row level security;
alter table huespedes             enable row level security;

create policy "politicas: lectura publica" on politicas_cancelacion
  for select using (true);
create policy "politicas: admin/gerencia gestionan" on politicas_cancelacion
  for all using (rol_actual() in ('admin','gerencia'))
  with check (rol_actual() in ('admin','gerencia'));

create policy "promos: lectura publica de activas o staff" on promociones
  for select using (activo or rol_actual() is not null);
create policy "promos: admin/gerencia gestionan" on promociones
  for all using (rol_actual() in ('admin','gerencia'))
  with check (rol_actual() in ('admin','gerencia'));

-- Datos personales: nunca públicos, solo staff.
create policy "huespedes: staff lee" on huespedes
  for select using (rol_actual() is not null);
create policy "huespedes: recepcion+ gestiona" on huespedes
  for all using (rol_actual() in ('admin','gerencia','recepcion'))
  with check (rol_actual() in ('admin','gerencia','recepcion'));
