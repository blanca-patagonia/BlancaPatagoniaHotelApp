-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0032 — El alta de un usuario nace SIN privilegios (Auditoría · Fase 3)
--
-- Qué corrige. La migración 0001 dejó `perfiles.rol` con default `'recepcion'` y
-- `perfiles.activo` con default `true`. El trigger `manejar_nuevo_usuario`
-- inserta solo `(id, nombre)`, así que toma ambos defaults. Como el trigger está
-- en `after insert on auth.users`, CUALQUIER alta —incluido un
-- `POST /auth/v1/signup` hecho desde internet con la clave publicable, que viaja
-- al navegador por diseño— creaba un perfil de recepción activo.
--
-- Ese perfil satisface directamente las políticas RLS del esquema
-- (`rol_actual() in ('admin','gerencia','recepcion')` sobre huéspedes, reservas,
-- pagos, consumos y facturas) y los GRANT de la migración 0006 ya habilitan a
-- `authenticated` sobre todas las tablas. Es decir: RLS era lo único que separaba
-- a un desconocido de la base entera, y el trigger se lo entregaba.
--
-- Por qué acá y no solo en la configuración. Apagar `enable_signup` es necesario
-- pero no suficiente: es una casilla del panel de Supabase que alguien puede
-- volver a marcar sin saber lo que habilita. Esta migración hace que, aun con el
-- registro abierto, un alta que no pase por `app/panel/usuarios` nazca sin
-- alcance. Defensa en profundidad: la configuración puede fallar, el default no.
--
-- El camino legítimo no se ve afectado: `app/panel/usuarios/actions.ts` crea el
-- usuario con `service_role` y después fija `rol` y `activo` explícitamente.
--
-- Referencias: ADR 0005 («los usuarios no se auto-registran»), ADR 0016.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Un rol sin ningún alcance ─────────────────────────────────────────────
-- `rol_actual()` devuelve este valor para un perfil recién creado. Ninguna
-- política RLS lo nombra, así que no habilita nada. Se agrega al enum en vez de
-- permitir NULL porque `rol` es `not null` y las políticas ya comparan con
-- `rol_actual() is not null`: un NULL las habría dejado pasar de otro modo.
alter type rol_usuario add value if not exists 'sin_rol';

-- ── 2. Los defaults dejan de conceder ────────────────────────────────────────
alter table perfiles alter column rol set default 'sin_rol';
alter table perfiles alter column activo set default false;

comment on column perfiles.rol is
  'Rol operativo. El default es sin_rol: un alta que no pase por app/panel/usuarios nace sin alcance.';
comment on column perfiles.activo is
  'El default es false: un alta no aprovisionada no puede iniciar sesión (ver lib/auth/session.ts).';

-- ── 3. El trigger deja constancia de por qué inserta lo que inserta ──────────
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

-- ── 4. Los perfiles ya existentes no se tocan ────────────────────────────────
-- A propósito: cambiar el rol de alguien que hoy trabaja sería un incidente
-- operativo. Si esta base estuvo expuesta con el registro abierto, revisá a mano
-- qué perfiles se crearon fuera del alta legítima:
--
--   select p.id, p.nombre, p.rol, p.activo, p.creado_en, u.email
--     from perfiles p join auth.users u on u.id = p.id
--    order by p.creado_en desc;
