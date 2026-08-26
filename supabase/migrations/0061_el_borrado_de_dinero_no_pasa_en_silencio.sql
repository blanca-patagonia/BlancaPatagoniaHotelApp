-- 0061 · El borrado de dinero no pasa en silencio
--
-- ── El problema, verificado ejecutándolo ────────────────────────────────────
--
-- Con una sesión de **recepción** se creó una reserva confirmada con USD 150 de
-- seña aprobada y un consumo, y se la borró por PostgREST:
--
--     ANTES:   {"pagos":1,"consumos":1,"estadias":1}
--     DELETE como recepción: ACEPTADO
--     DESPUÉS: {"pagos":0,"consumos":0,"estadias":0}
--
-- Se fueron el pago, el consumo y la estadía, arrastrados por las cascadas de las
-- migraciones 0009 y 0010. Ninguna pantalla ofrece ese borrado —no hay un solo
-- `.delete()` sobre `reservas` en todo el código—, así que es alcanzable solo con
-- una llamada directa a la API usando una sesión válida de staff.
--
-- Dos cosas están mal ahí, y se arreglan por separado:
--
--   1. **Se puede borrar.** El sistema tiene una máquina de estados con
--      `cancelada` y `no_show` justamente para no perder el historial, y borrar
--      la saltea entera: la reserva desaparece y con ella el cargo por
--      cancelación que el hotel debía cobrar.
--   2. **No queda rastro.** El trigger de `reservas` es `after update` (0020:78),
--      así que un DELETE no se audita. `consumos` y los dos `movimientos_*` no
--      tienen trigger en absoluto. El único indicio era la fila DELETE de
--      `pagos` —esa sí auditada—, apuntando a una `reserva_id` que ya no existe.

-- ── 1. Quitar el permiso de borrar donde no corresponde ─────────────────────
--
-- El camino correcto ya existe: la máquina de estados para reservas, y la baja
-- lógica (`activo`) para agencias, proveedores, unidades, tarifas y perfiles.
-- Ninguna pantalla usa el borrado físico de estas tablas.
--
-- Se revoca a `authenticated`, que incluye a **todos** los roles de staff, admin
-- incluido. Es deliberado: si alguna vez hay que borrar una reserva de verdad, es
-- una intervención de base con `service_role`, no un clic. El `service_role`
-- conserva el permiso —lo necesitan el portal, el webhook, el cron y los tests—.

revoke delete on reservas    from authenticated;
revoke delete on estadias    from authenticated;
revoke delete on pagos       from authenticated;
revoke delete on agencias    from authenticated;
revoke delete on proveedores from authenticated;
revoke delete on tarifas     from authenticated;
revoke delete on perfiles    from authenticated;

-- ⚠️ Lo que NO se revoca, y por qué. Estas cuatro las usa la interfaz y quitarlas
-- rompería funciones que hoy andan:
--
--   · `consumos`              — «quitar consumo» de la cuenta y «anular comanda»
--                               del punto de venta. Se auditan más abajo.
--   · `huespedes`             — la compensación de `crearReservaAction`: si la
--                               reserva falla después de crear la ficha, la borra
--                               para no dejar un huésped sin reserva.
--   · `avisos`                — se dan de baja borrándolos.
--   · `temporada_rangos`      — se editan quitando y volviendo a agregar rangos.
--   · `canal_mapeos_columnas` — ídem.

-- ── 2. Que el borrado deje rastro ───────────────────────────────────────────
--
-- `registrar_auditoria()` (migración 0020) ya es genérica: guarda la fila completa
-- en `datos_previos`, con el actor y su rol. Sumar una tabla es sumar un trigger.
--
-- Se cubren las cuatro que faltaban. `pagos` y `tarifas` ya estaban.

create trigger reservas_borrado_auditoria
  after delete on reservas
  for each row execute function registrar_auditoria();

comment on trigger reservas_borrado_auditoria on reservas is
  'El trigger de la 0020 era `after update`: un DELETE no dejaba rastro. Va aparte y no se amplía aquél porque ése solo audita el cambio de estado, no toda modificación.';

create trigger estadias_borrado_auditoria
  after delete on estadias
  for each row execute function registrar_auditoria();

-- `consumos` con las tres operaciones: la interfaz sí borra acá, y un cargo que
-- desaparece de la cuenta del huésped es dinero que el hotel deja de cobrar.
create trigger consumos_auditoria
  after insert or update or delete on consumos
  for each row execute function registrar_auditoria();

-- Las dos cuentas corrientes. Se cubren las tres operaciones por el mismo motivo
-- que `pagos`: cada fila es plata que alguien debe o pagó.
create trigger movimientos_cuenta_auditoria
  after insert or update or delete on movimientos_cuenta
  for each row execute function registrar_auditoria();

create trigger movimientos_proveedor_auditoria
  after insert or update or delete on movimientos_proveedor
  for each row execute function registrar_auditoria();

-- ── 3. Las cascadas se dejan como están, y es una decisión ──────────────────
--
-- `pagos.reserva_id`, `consumos.reserva_id`, `movimientos_cuenta.agencia_id` y
-- `movimientos_proveedor.proveedor_id` siguen en `on delete cascade`.
--
-- La tentación es pasarlas a `restrict` para que el borrado falle en vez de
-- propagarse. Se evaluó y se descartó:
--
--   · El agujero ya está cerrado por el punto 1: con `authenticated` sin permiso
--     de DELETE, la cascada no la puede disparar ninguna sesión de staff.
--   · Los únicos que conservan el permiso son `service_role` y el dueño de la
--     base, y ahí la cascada es lo correcto: cuando una limpieza legítima borra
--     una reserva, tiene que llevarse sus hijos. Con `restrict` habría que
--     borrar cinco tablas en el orden exacto, y el primer olvido deja huérfanos.
--   · Cambiar la semántica de cuatro claves foráneas es un cambio de mayor
--     alcance que el problema que resuelve.
--
-- Con el punto 2, además, cualquier borrado por `service_role` queda registrado.
