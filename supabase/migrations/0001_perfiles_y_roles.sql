-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0001 — Perfiles y roles (Fase 0)
-- Define los roles del sistema y la tabla de perfiles vinculada a auth.users.
-- ─────────────────────────────────────────────────────────────────────────────

-- Roles operativos del hotel (ver lib/domain/roles.ts).
create type rol_usuario as enum ('admin', 'gerencia', 'recepcion', 'housekeeping');

-- Un perfil por usuario de Supabase Auth.
create table perfiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text not null default '',
  rol        rol_usuario not null default 'recepcion',
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

comment on table perfiles is 'Perfil y rol de cada usuario del staff del hotel.';

alter table perfiles enable row level security;

-- ── Helper: rol del usuario autenticado ──────────────────────────────────────
-- SECURITY DEFINER + search_path fijo: evita recursión de RLS al consultarse a
-- sí misma desde las políticas de la tabla `perfiles`.
create or replace function rol_actual()
returns rol_usuario
language sql
stable
security definer
set search_path = public
as $$
  select rol from perfiles where id = auth.uid();
$$;

-- ── Trigger: crear el perfil automáticamente al registrarse ───────────────────
create or replace function manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into perfiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', new.email));
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function manejar_nuevo_usuario();

-- ── Políticas RLS ─────────────────────────────────────────────────────────────
create policy "perfiles: cada uno ve el suyo"
  on perfiles for select
  using (id = auth.uid());

create policy "perfiles: admin ve todos"
  on perfiles for select
  using (rol_actual() = 'admin');

create policy "perfiles: admin gestiona todos"
  on perfiles for all
  using (rol_actual() = 'admin')
  with check (rol_actual() = 'admin');
