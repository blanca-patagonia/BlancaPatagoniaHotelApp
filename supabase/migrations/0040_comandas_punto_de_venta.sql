-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0040 — Comandas del punto de venta (Modernización WinPAX, paso 7)
--
-- ── Qué falta hoy ────────────────────────────────────────────────────────────
--
-- Cargar un consumo funciona, pero se hace desde el detalle de la reserva con un
-- `<select>` y una cantidad, **de a un producto por vez**. Para cerrar un
-- frigobar de cinco artículos hay que repetir la operación cinco veces, y las
-- cinco líneas quedan sueltas: no hay forma de saber que fueron el mismo
-- recuento, ni de anular el recuento completo si se cargó en la habitación
-- equivocada.
--
-- WinPAX tenía una grilla por departamento y un **número de comanda** que agrupa
-- las líneas. Eso es lo que falta.
--
-- ── Por qué NO se crea una tabla de comandas ─────────────────────────────────
--
-- La tentación es `comandas` + `comanda_lineas`. Sería duplicar `consumos`, que ya
-- tiene todo lo que hace falta —producto, cantidad, precio con snapshot, fecha,
-- quién lo cargó— y que **ya impacta en la cuenta del huésped** por un camino
-- probado (`cuentaConsolidada`, la factura, los reportes de `servicio`).
--
-- Una comanda no es una entidad con vida propia: es un **agrupador** de líneas que
-- se cargaron juntas. Alcanza un número compartido. Así el POS nuevo escribe en la
-- misma tabla que el resto del sistema y no hay dos caminos por los que un consumo
-- pueda llegar a la cuenta.
--
-- ⚠️ NO confundir con la tabla `puntos_venta` (migración 0025), que es el punto de
-- venta **fiscal** para numerar facturas. Nombre parecido, cosa distinta.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Numerador de comandas ────────────────────────────────────────────────────
-- Una secuencia y no un contador en tabla: `nextval` es atómico y no bloquea, así
-- que dos personas cargando comandas al mismo tiempo no se pisan ni se esperan.
--
-- Los huecos son aceptables acá y por eso se puede usar una secuencia: si alguien
-- abre el POS y no confirma, ese número se pierde y no importa. Es exactamente lo
-- contrario de la numeración de facturas (0025/0033), que **no puede tener huecos**
-- por exigencia fiscal y por eso lleva un contador en tabla.
create sequence comandas_numero_seq as bigint start 1;

comment on sequence comandas_numero_seq is
  'Numerador de comandas del punto de venta. Admite huecos a propósito: no es numeración fiscal (comparar con puntos_venta.ultimo_numero, que no puede tenerlos).';

-- ── Agrupador en los consumos ────────────────────────────────────────────────
alter table consumos
  -- Nulo en todo lo cargado hasta ahora, y eso es correcto: esas líneas se
  -- cargaron de a una desde el detalle de la reserva y nunca fueron una comanda.
  add column comanda bigint,
  -- Departamento que la vendió. Hoy se deriva de la categoría del producto; el
  -- paso 8 va a formalizar la jerarquía departamento/subdepartamento.
  add column punto text not null default 'recepcion'
    check (punto in ('recepcion', 'frigobar', 'room_service', 'restaurante', 'excursiones')),
  -- Nota de la línea: «sin hielo», «se rompió una copa». WinPAX la tenía y sirve.
  add column nota text not null default '';

comment on column consumos.comanda is
  'Número que agrupa las líneas cargadas juntas en el punto de venta. Nulo en los consumos cargados de a uno.';
comment on column consumos.punto is
  'Dónde se vendió. El paso 8 lo va a reemplazar por la jerarquía departamento/subdepartamento.';

-- La consulta del POS es «traeme la comanda tal»; la del listado, «las comandas de
-- esta reserva». El índice parcial deja afuera las líneas sin comanda, que son
-- todas las históricas.
create index consumos_comanda_idx on consumos (comanda) where comanda is not null;
create index consumos_punto_fecha_idx on consumos (punto, fecha desc);

-- ── Función para pedir el número ─────────────────────────────────────────────
-- Se expone como función y no se usa `nextval` directo desde la aplicación para no
-- tener que otorgar permisos sobre la secuencia a `authenticated`, y para que el
-- día que la numeración cambie de forma (por punto de venta, por día) el cambio
-- quede contenido acá.
create or replace function siguiente_comanda()
returns bigint
language sql
volatile
as $$
  select nextval('comandas_numero_seq');
$$;

comment on function siguiente_comanda() is
  'Devuelve el próximo número de comanda. Admite huecos: no es numeración fiscal.';

grant usage, select on sequence comandas_numero_seq to authenticated, service_role;
grant execute on function siguiente_comanda() to authenticated, service_role;
