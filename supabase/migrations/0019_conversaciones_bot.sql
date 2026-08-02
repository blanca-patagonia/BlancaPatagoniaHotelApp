-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0019 — Conversaciones internas y consultas del bot (Fase 10)
--
-- Inspirada en la app "Conversaciones" (Discuss) de Odoo. Se diferencia del
-- módulo Avisos ya existente:
--   · Avisos          → cartelera unidireccional (se publica y se lee).
--   · Conversaciones  → chat bidireccional por área, en tiempo real.
--
-- Incluye además la bandeja de consultas que el asistente del portal público no
-- supo responder, para que el staff les dé seguimiento.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Canales ──────────────────────────────────────────────────────────────────
create table canales (
  id          uuid primary key default gen_random_uuid(),
  clave       text        not null unique,
  nombre      text        not null,
  descripcion text,
  -- Roles que participan del canal. Un array (y no una tabla puente) alcanza:
  -- son 4 roles fijos y la consulta de permiso queda en una sola condición.
  roles       rol_usuario[] not null default '{}',
  creado_en   timestamptz not null default now()
);

comment on table canales is 'Canales de chat interno del staff, con los roles que participan.';
comment on column canales.roles is 'Roles habilitados; admin siempre entra a todos.';

create table mensajes (
  id        uuid        primary key default gen_random_uuid(),
  canal_id  uuid        not null references canales (id) on delete cascade,
  autor_id  uuid        references perfiles (id),
  cuerpo    text        not null check (length(trim(cuerpo)) > 0),
  creado_en timestamptz not null default now()
);

comment on table mensajes is 'Mensajes de los canales de chat interno.';
create index on mensajes (canal_id, creado_en desc);

-- ── Permiso de canal ─────────────────────────────────────────────────────────
-- Se encapsula en una función para no repetir la condición en cada política y
-- para que `mensajes` pueda apoyarse en la pertenencia del canal.
create or replace function puede_ver_canal(p_canal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select rol_actual() = 'admin'
      or exists (
           select 1 from canales c
           where c.id = p_canal
             and rol_actual() = any (c.roles)
         );
$$;

comment on function puede_ver_canal(uuid) is
  'Verdadero si el rol actual participa del canal (admin entra a todos).';

-- ── Consultas del asistente público ──────────────────────────────────────────
-- Preguntas que el bot no supo responder. Las carga el servidor con
-- `service_role` desde una Server Action; `anon` NO tiene política de INSERT,
-- para no dejar una tabla escribible desde internet.
create table consultas_bot (
  id          uuid        primary key default gen_random_uuid(),
  pregunta    text        not null check (length(trim(pregunta)) > 0),
  contacto    text,
  respondida  boolean     not null default false,
  creado_en   timestamptz not null default now()
);

comment on table consultas_bot is
  'Preguntas del portal público que el asistente no pudo responder; el staff les da seguimiento.';
create index on consultas_bot (respondida, creado_en desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table canales       enable row level security;
alter table mensajes      enable row level security;
alter table consultas_bot enable row level security;

create policy "canales: participantes leen" on canales
  for select using (rol_actual() = 'admin' or rol_actual() = any (roles));
create policy "canales: admin gestiona" on canales
  for all using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

create policy "mensajes: participantes leen" on mensajes
  for select using (puede_ver_canal(canal_id));
create policy "mensajes: participantes escriben" on mensajes
  for insert with check (puede_ver_canal(canal_id) and autor_id = auth.uid());
create policy "mensajes: autor o admin borra" on mensajes
  for delete using (autor_id = auth.uid() or rol_actual() = 'admin');

create policy "consultas_bot: staff lee" on consultas_bot
  for select using (rol_actual() is not null);
create policy "consultas_bot: staff actualiza" on consultas_bot
  for update using (rol_actual() is not null) with check (rol_actual() is not null);

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Habilita que el chat reciba los mensajes nuevos por WebSocket sin recargar.
alter publication supabase_realtime add table mensajes;

-- ── Canales iniciales ────────────────────────────────────────────────────────
insert into canales (clave, nombre, descripcion, roles) values
  ('general',       'General',       'Todo el equipo del hotel.',
   '{admin,gerencia,recepcion,housekeeping}'),
  ('recepcion',     'Recepción',     'Coordinación de llegadas, salidas y huéspedes.',
   '{admin,gerencia,recepcion}'),
  ('housekeeping',  'Housekeeping',  'Limpieza, asignaciones y novedades de las unidades.',
   '{admin,gerencia,housekeeping}'),
  ('mantenimiento', 'Mantenimiento', 'Averías, tareas y seguimiento de órdenes.',
   '{admin,gerencia,housekeeping}');
