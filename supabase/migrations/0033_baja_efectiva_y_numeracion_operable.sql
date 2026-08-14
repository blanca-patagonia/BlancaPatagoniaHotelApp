-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0033 — La baja de un usuario surte efecto y la numeración funciona
--                  (Auditoría · Fase 3)
--
-- Dos correcciones independientes que comparten causa: una función de Postgres
-- cuyo modo de ejecución no coincide con lo que la función necesita hacer.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. `rol_actual()` ignoraba `perfiles.activo`
-- ═════════════════════════════════════════════════════════════════════════════
--
-- La definición original (0001:32) era:
--
--     select rol from perfiles where id = auth.uid();
--
-- Sin mirar `activo`. Como esta función es la que consultan las ~60 políticas
-- RLS del esquema, dar de baja a alguien desde `app/panel/usuarios` **no le
-- quitaba ningún permiso sobre la base**: seguía leyendo el padrón de huéspedes,
-- los pagos y las facturas mientras conservara un token válido (hasta una hora,
-- por `jwt_expiry`, y renovable).
--
-- La columna `activo` sí la miraba `obtenerSesion` (lib/auth/session.ts:32), es
-- decir la aplicación. Pero la aplicación no es la barrera: PostgREST está
-- expuesto y `authenticated` tiene GRANT sobre todas las tablas (0006:14). El
-- panel bloqueaba la puerta de entrada mientras la ventana quedaba abierta.
--
-- Caso real que esto habilita: se da de baja a un empleado que deja el hotel y
-- conserva acceso a los datos personales de los huéspedes.

create or replace function rol_actual()
returns rol_usuario
language sql
stable
security definer
set search_path = public
as $$
  -- `activo` se evalúa acá, no en la app: es la base la que tiene que negar.
  -- Un perfil dado de baja devuelve NULL, y NULL no satisface ninguna política
  -- (todas comparan con `rol_actual() is not null` o con una lista de roles).
  select rol from perfiles where id = auth.uid() and activo;
$$;

comment on function rol_actual() is
  'Rol del usuario autenticado, o NULL si el perfil está dado de baja. Lo consultan todas las políticas RLS: la baja tiene efecto inmediato en la base, no solo en la app.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. `siguiente_numero_comprobante()` no podía escribir el contador
-- ═════════════════════════════════════════════════════════════════════════════
--
-- La función se declaró sin `security definer` (0025:41-44), así que corre como
-- SECURITY INVOKER: con los permisos de quien la llama. Y la misma migración, en
-- la línea 76, hace:
--
--     revoke update on puntos_venta from authenticated;
--
-- Ese revoke es correcto y deliberado: nadie debe poder mover el contador de
-- comprobantes a mano. Pero deja a la función sin el UPDATE que necesita para
-- avanzarlo, así que **toda emisión de factura desde el panel falla**, para
-- todos los roles. No es una vulnerabilidad: es la funcionalidad de facturación
-- rota de punta a punta (`app/panel/reservas/actions.ts:469`).
--
-- La corrección es que la función corra como su dueño. Ese es exactamente el
-- caso de uso de SECURITY DEFINER: dar acceso acotado a una operación
-- privilegiada a través de una interfaz controlada, en vez de repartir el
-- permiso crudo sobre la tabla.
--
-- ⚠️ Con SECURITY DEFINER hay que fijar `search_path`, si no la función es un
-- vector de secuestro: quien la invoque podría anteponer un esquema propio con
-- objetos de igual nombre. Es la misma precaución que ya toman `rol_actual()` y
-- `manejar_nuevo_usuario()`.
--
-- ⚠️ Y NO se aplica el mismo criterio a `cotizar_estadia`: ahí `current_user`
-- pasaría a ser el dueño de la función y la guarda del precio neto quedaría
-- siempre en verdadero (ADR 0016).

do $$
declare
  cuerpo text;
begin
  -- Se re-declara conservando el cuerpo existente, sin reescribir la lógica de
  -- numeración: lo único que cambia es el modo de ejecución. Reescribirla a mano
  -- correría el riesgo de introducir una diferencia sutil en el correlativo.
  select pg_get_functiondef(p.oid) into cuerpo
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'siguiente_numero_comprobante';

  if cuerpo is null then
    raise exception 'No se encontró siguiente_numero_comprobante: revisá la migración 0025.';
  end if;

  if position('SECURITY DEFINER' in upper(cuerpo)) > 0 then
    raise notice 'siguiente_numero_comprobante ya es SECURITY DEFINER; no se toca.';
    return;
  end if;

  execute replace(
    cuerpo,
    'LANGUAGE plpgsql',
    'LANGUAGE plpgsql SECURITY DEFINER SET search_path = public'
  );
end
$$;

comment on function siguiente_numero_comprobante(int) is
  'Avanza y devuelve el correlativo del punto de venta. SECURITY DEFINER: es el único camino permitido para tocar el contador, ya que a authenticated se le revocó el UPDATE sobre puntos_venta (0025:76).';


-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Debe listar las tres funciones como SECURITY DEFINER con search_path fijo:
--   select p.proname, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('rol_actual', 'manejar_nuevo_usuario', 'siguiente_numero_comprobante');
--
--   -- `cotizar_estadia` debe seguir con prosecdef = false (ADR 0016):
--   select proname, prosecdef from pg_proc where proname = 'cotizar_estadia';
