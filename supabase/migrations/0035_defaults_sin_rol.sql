-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0035 — Segunda mitad de la 0032: los defaults dejan de conceder
--                  (Auditoría · Fase 3)
--
-- Es la continuación literal de `0032_alta_de_usuario_sin_privilegios.sql`, que
-- explica el problema y por qué se corrige en la base y no solo en la
-- configuración. Acá está únicamente lo que USA el valor `sin_rol`.
--
-- Por qué está separado. `alter type ... add value` no se puede usar en la misma
-- transacción que lo agrega: Postgres corta con SQLSTATE 55P04 («unsafe use of
-- new value of enum type»). El CLI de Supabase envuelve cada archivo de
-- migración en una transacción, así que las dos partes juntas hacían fallar
-- `supabase db reset` en la 0032 —y con ella todas las migraciones siguientes—.
-- Al quedar en archivos distintos, la 0032 commitea el valor nuevo y esta ya lo
-- encuentra disponible.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Los defaults dejan de conceder ────────────────────────────────────────
alter table perfiles alter column rol set default 'sin_rol';
alter table perfiles alter column activo set default false;

comment on column perfiles.rol is
  'Rol operativo. El default es sin_rol: un alta que no pase por app/panel/usuarios nace sin alcance.';
comment on column perfiles.activo is
  'El default es false: un alta no aprovisionada no puede iniciar sesión (ver lib/auth/session.ts).';

-- ── 2. El trigger deja constancia de por qué inserta lo que inserta ──────────
-- Se reescribe con los valores EXPLÍCITOS. Antes dependía de los defaults de la
-- tabla, y por eso cambiar un default cambiaba en silencio quién entraba al
-- sistema. Ahora la intención está escrita en la función y no se puede alterar
-- desde otro lado sin verla.
create or replace function manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into perfiles (id, nombre, rol, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', new.email),
    'sin_rol',   -- explícito: el alta no concede nada
    false        -- explícito: hasta que un administrador lo habilite
  );
  return new;
end;
$$;

comment on function manejar_nuevo_usuario() is
  'Crea el perfil al dar de alta un usuario. Nace sin rol y desactivado: habilitarlo es un acto deliberado desde app/panel/usuarios.';

-- ── 3. Los perfiles ya existentes no se tocan ────────────────────────────────
-- A propósito: cambiar el rol de alguien que hoy trabaja sería un incidente
-- operativo. Si esta base estuvo expuesta con el registro abierto, revisá a mano
-- qué perfiles se crearon fuera del alta legítima:
--
--   select p.id, p.nombre, p.rol, p.activo, p.creado_en, u.email
--     from perfiles p join auth.users u on u.id = p.id
--    order by p.creado_en desc;


-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Los defaults tienen que ser sin_rol / false:
--   select column_name, column_default
--     from information_schema.columns
--    where table_name = 'perfiles' and column_name in ('rol', 'activo');
--
--   -- Y el enum tiene que incluir el valor:
--   select enumlabel from pg_enum e
--     join pg_type t on t.oid = e.enumtypid
--    where t.typname = 'rol_usuario' order by e.enumsortorder;
