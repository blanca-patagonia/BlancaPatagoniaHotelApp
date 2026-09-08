# ADR 0033 — Arrastrar una reserva en la grilla cambia de habitación, no de fechas

- **Estado:** Aceptada
- **Fecha:** 2026-09-08
- **Se apoya en:** [ADR 0002](0002-motor-de-disponibilidad.md) (la garantía es
  de la base) y la migración `0028` (`cambiar_unidad_reserva`)
- **Origen:** pedido del cliente por audio del 2026-09-07, mostrando la grilla
  mensual de WinPAX: *«que puedas agarrar las reservas con el mouse, la
  seleccionás y la puedas mover»*.

## Contexto

La grilla de ocupación ya mostraba las estadías como bloques de color sobre una
matriz de habitaciones por días —lo mismo que WinPAX—, pero para mover a un
huésped había que salir de la pantalla: abrir la reserva, buscar «cambiar
unidad», elegir el destino de una lista. El cliente hace ese movimiento varias
veces por día y lo pidió con el gesto que ya conocía.

En un bloque arrastrado dentro de esa matriz hay **dos ejes**, y significan
cosas muy distintas:

- **Vertical** (otra fila) = otra habitación. Es la mudanza que ya existe.
- **Horizontal** (otras columnas) = otras fechas. Es la reprogramación, que
  **recotiza la estadía**: cambia el precio por noche y el total.

El pedido no distingue entre las dos, porque mirando la pantalla son el mismo
gesto.

## Decisión

**El arrastre mueve de habitación y sólo de habitación.** El eje horizontal no
existe: soltar un bloque corridos tres días a la derecha no cambia nada.

### Por qué no las fechas

Un arrastre es un gesto **de bajo costo y alto error**. En una grilla de cuarenta
filas por treinta columnas, con celdas de cuarenta píxeles, el mouse se resbala.
Que un resbalón cambie de habitación es molesto y se revierte arrastrando de
vuelta. Que un resbalón **cambie lo que el huésped paga** es otra cosa: la
recotización escribe `precio_noche` y `total` (migración 0085), y si el huésped
ya tiene factura emitida, el comprobante deja de coincidir con la reserva.

Se evaluó permitirlo con confirmación. La confirmación ayuda, pero no alcanza:
lo que la hace segura en la mudanza es que el usuario puede leer el diálogo y
entender la consecuencia completa —«pasa de la 12 a la 4»—. Para las fechas, la
consecuencia completa incluye un número que no estaba en pantalla y que hay que
ir a buscar a las tarifas. Reprogramar sigue teniendo su pantalla, donde el
precio nuevo se ve antes de decidir.

### Por qué no es una función nueva

La mudanza no se reimplementó. El arrastre termina llamando a la misma Server
Action (`cambiarUnidadReserva`) y a la misma función SQL de la migración 0028,
que mueve la estadía y ensucia la unidad liberada en una transacción. Lo único
que se agregó del lado del servidor es **a dónde vuelve** cuando termina: antes
volvía siempre a la ficha de la reserva, y eso sacaba a recepción de la grilla
en la que estaba trabajando.

⚠️ Esa ruta de retorno viaja como **token de una lista blanca de dos valores**,
no como una URL. Un campo de formulario con «volvé acá» es un redirect abierto:
quien consiga que se envíe ese formulario elige dónde termina la sesión. La
decisión vive en `lib/retorno.ts` —función pura, con tests que le tiran
`//evil.example`, `javascript:` y `../..`— y no adentro de la acción, porque la
parte peligrosa de ese código **es una decisión, no una escritura**: dejarla en
un archivo `server-only` la habría vuelto testeable sólo con base levantada.

### La validación en el navegador es una comodidad, no la garantía

El arrastre no deja soltar sobre una habitación ocupada, y marca la fila en rojo.
Eso lo decide `lib/domain/arrastre-grilla.ts` con los datos que ya están en
pantalla, sin ir al servidor.

**No es la garantía y no puede serlo.** Entre que se dibujó la grilla y se soltó
el bloque, otra recepcionista pudo vender esa unidad. La garantía sigue siendo la
restricción de exclusión sobre `estadias` (ADR 0002), y la pantalla sabe mostrar
su rechazo (`23P01` → «esa unidad ya está ocupada en esas fechas»).

Hay un detalle que sí se pudo demostrar y quedó escrito en el código: la grilla
trae las estadías que **se solapan con la ventana visible**, así que si el bloque
arrastrado entra entero en esa ventana, cualquier estadía que pudiera chocar con
él se solapa con el bloque y por lo tanto ya está en pantalla — la comprobación
local es **completa**. En cuanto el bloque se sale por un costado deja de serlo, y
ahí el diálogo lo dice en vez de afirmar una disponibilidad que no verificó
(`ventanaAlcanza`).

### El arrastre no es una puerta: es un atajo

No hay arrastre con el dedo (HTML5 *drag and drop* no existe en táctil) ni con
teclado. Por eso el bloque **sigue siendo un enlace** a la ficha de la reserva, y
el camino de siempre no se movió. La leyenda de la grilla aclara que el gesto es
con mouse: una instrucción que no funciona en el dispositivo que se tiene en la
mano es peor que no darla.

Esto también es lo que hace que la función no dependa de JavaScript: sin él, la
grilla se comporta exactamente como antes.

## Consecuencias

- Recepción muda a un huésped en dos gestos en vez de en cinco pantallas.
- Correr fechas sigue costando lo mismo que antes. Es deliberado: es la operación
  que toca plata.
- La grilla se sigue dibujando en el servidor. El envoltorio de cliente sólo
  escucha eventos, así que no se paga el peso de mandar cuarenta filas de datos
  de huéspedes al navegador para poder arrastrarlas.
- Si mañana se quiere el eje horizontal, el lugar es este ADR y no el código: la
  parte difícil (mostrar el precio nuevo antes de aplicar) es de producto.

## Alternativas descartadas

**Arrastre libre en los dos ejes, con confirmación.** Descartada por lo de
arriba: la confirmación no puede mostrar lo que hace falta saber sin volver a
cotizar, y una cotización dentro del gesto convierte un movimiento de mouse en
una espera de red.

**Permitir mover fechas sólo si el total no cambia.** Suena seguro y no lo es:
que dos períodos coticen igual hoy no significa que la reserva no haya nacido con
un precio acordado distinto del de tarifa, y la regla sería invisible —a veces el
arrastre funciona y a veces no, sin que se entienda por qué—.

**Reescribir la grilla como componente de cliente.** Habría hecho el arrastre más
simple de programar y la pantalla más pesada para todos, incluidos los que nunca
arrastran nada. Se resolvió con delegación de eventos sobre la tabla que dibuja
el servidor.
