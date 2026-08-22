-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0045 — Una factura por reserva, y el padrón vedado a housekeeping
--
-- Los dos hallazgos P0 que la bitácora dejó abiertos y que siguen vivos. Los dos
-- se resuelven en la base porque los dos son garantías, no validaciones: la app
-- puede olvidarse de comprobar, la base no.
--
-- ── 1. Dos facturas para la misma reserva ────────────────────────────────────
--
-- `emitirFactura` es **check-then-act**:
--
--     select id from facturas where reserva_id = X   -- ¿ya existe?
--     …
--     insert into facturas (…)                        -- no existía: se emite
--
-- Entre las dos sentencias no hay nada. Dos clics simultáneos —o un doble clic que
-- `BotonEnvio` no llegue a frenar, o dos personas cerrando la misma reserva desde
-- dos puestos— pasan los dos por el `select`, no encuentran nada, y emiten **dos
-- comprobantes fiscales de la misma estadía**.
--
-- No es un duplicado cualquiera: con un CAE real son dos documentos ante AFIP, y
-- arreglarlo exige emitir una nota de crédito. Es exactamente el tipo de invariante
-- que no puede vivir en la aplicación.
--
-- ── 2. Housekeeping lee el padrón completo ───────────────────────────────────
--
-- Las políticas de `huespedes`, `pagos` y `facturas` dicen
-- `rol_actual() is not null`: **cualquier rol de staff logueado**. La matriz del
-- ADR 0005 es explícita — para housekeeping, Huéspedes es «—» — y esas tres tablas
-- tienen nombre, email, teléfono, documento, condición de IVA, importes cobrados y
-- comprobantes fiscales.
--
-- Una mucama necesita saber qué habitación limpiar y en qué estado está. No
-- necessita el teléfono del huésped ni cuánto pagó.
--
-- ⚠️ NO se toca `reservas` ni `estadias`, y es deliberado: el tablero de inicio de
-- housekeeping calcula las llegadas y salidas del día a partir de `estadias`, y la
-- vista «Mi trabajo» las usa para priorizar la limpieza. La fila «Reservas» de la
-- matriz del ADR 0005 habla del **área del panel** —que housekeeping no tiene— no
-- de la lectura cruda de la tabla. Los nombres de huésped que el tablero muestra
-- salen de un bloque que ya está detrás de `puede('reservas')`, así que al quedar
-- `huespedes` fuera de alcance ese embed devuelve nulo y no se ve nada raro.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Una factura por reserva ───────────────────────────────────────────────

-- Antes de imponer la restricción hay que saber si el problema ya ocurrió. Si hay
-- duplicados, la migración corta acá con un mensaje accionable en vez de fallar
-- con «could not create unique index», que no dice qué reserva revisar.
do $$
declare
  v_duplicadas text;
begin
  select string_agg(reserva_id::text, ', ')
    into v_duplicadas
    from (select reserva_id from facturas group by reserva_id having count(*) > 1) d;

  if v_duplicadas is not null then
    raise exception
      'Hay reservas con más de una factura y hay que resolverlas a mano antes de aplicar esta migración: %',
      v_duplicadas
      using hint = 'Cada una necesita decidir qué comprobante queda y emitir nota de crédito por el otro.';
  end if;
end $$;

alter table facturas
  add constraint facturas_una_por_reserva unique (reserva_id);

comment on constraint facturas_una_por_reserva on facturas is
  'Una reserva se factura UNA vez. `emitirFactura` es check-then-act y sin esto dos emisiones simultáneas generaban dos comprobantes fiscales de la misma estadía.';

-- ── 2. El padrón, fuera del alcance de housekeeping ──────────────────────────
-- Se reemplazan las tres políticas de lectura. `drop` + `create` y no un `alter`:
-- una política se altera con `alter policy`, pero dejar el nombre viejo («staff
-- lee») describiendo algo que ya no es «todo el staff» sería peor que renombrarla.

drop policy "huespedes: staff lee" on huespedes;
create policy "huespedes: recepcion+ lee" on huespedes
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

drop policy "pagos: staff lee" on pagos;
create policy "pagos: recepcion+ lee" on pagos
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

drop policy "facturas: staff lee" on facturas;
create policy "facturas: recepcion+ lee" on facturas
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

-- Las políticas de escritura ya estaban acotadas a `('admin','gerencia','recepcion')`
-- en las tres tablas, así que no hacía falta tocarlas. Se deja anotado para que
-- quien lea esto no salga a buscarlas.
