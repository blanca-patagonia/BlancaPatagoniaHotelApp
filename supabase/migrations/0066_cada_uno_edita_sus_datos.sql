-- 0066 · Cada uno puede editar sus propios datos, y solo los suyos.
--
-- ── Qué habilita ────────────────────────────────────────────────────────────
--
-- Hasta acá «Mi cuenta» solo dejaba cambiar la contraseña: el nombre lo tenía que
-- corregir un administrador, y un apellido mal escrito quedaba así hasta que
-- alguien con permisos se acordara. Ahora cada uno edita su nombre y su teléfono.
--
-- ── El límite, que es la parte importante ───────────────────────────────────
--
-- Dejar que alguien edite su propia fila de `perfiles` es peligroso por una razón
-- puntual: en esa fila está `rol`. Una política de UPDATE con `id = auth.uid()` y
-- nada más habilita el **auto-ascenso**: cualquiera con la clave publicable
-- —que viaja al navegador por diseño— podría ponerse `admin`.
--
-- Y no alcanza con que la pantalla no ofrezca el campo. La defensa tiene que
-- estar en la base, que es donde llega la petición.
--
-- Se cierra con permisos POR COLUMNA: `authenticated` pierde el UPDATE de tabla y
-- solo recupera `nombre` y `telefono`. Postgres rechaza cualquier intento de
-- tocar `rol` o `activo` con el cliente del usuario, venga de donde venga.
--
-- ⚠️ Hay que REVOCAR el de tabla primero. Un `grant update (columna)` sobre un
-- GRANT de tabla existente no recorta nada: son dos catálogos distintos
-- (`relacl` y `attacl`) y el de tabla sigue mandando. Es la misma trampa que
-- documenta AGENTS.md a partir de la 0034.
--
-- El administrador no se ve afectado: gestiona usuarios con `service_role`
-- (`crearClienteAdmin`, ver `app/panel/usuarios/actions.ts`), que saltea tanto
-- RLS como los permisos de columna.

-- ── Teléfono ────────────────────────────────────────────────────────────────
-- Para que housekeeping pueda ubicar a recepción sin salir del sistema. Es
-- opcional: nadie queda obligado a dar su número.
alter table perfiles add column if not exists telefono text not null default '';

comment on column perfiles.telefono is
  'Teléfono de contacto interno del staff. Opcional, lo carga cada uno desde Mi cuenta.';

-- Un largo razonable. No se valida el formato: los internos del hotel, los
-- celulares con característica y los números con prefijo internacional se
-- escriben de formas muy distintas, y un patrón estricto solo lograría que la
-- gente no lo cargue.
alter table perfiles drop constraint if exists perfiles_telefono_largo;
alter table perfiles add constraint perfiles_telefono_largo
  check (length(telefono) <= 40);

-- ── Permiso de escritura, acotado por columna ───────────────────────────────
revoke update on perfiles from authenticated;
grant update (nombre, telefono) on perfiles to authenticated;

-- ── Política: cada uno, la suya ─────────────────────────────────────────────
-- `using` mira la fila que se va a modificar y `with check` la que quedaría: las
-- dos exigen que sea la propia, para que nadie pueda mover su fila a otro `id`.
drop policy if exists "perfiles: cada uno edita el suyo" on perfiles;
create policy "perfiles: cada uno edita el suyo"
  on perfiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

comment on policy "perfiles: cada uno edita el suyo" on perfiles is
  'Editar los datos propios. El alcance real lo fija el permiso por columna: solo nombre y telefono.';
