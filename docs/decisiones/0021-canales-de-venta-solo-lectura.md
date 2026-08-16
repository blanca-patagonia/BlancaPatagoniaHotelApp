# ADR 0021 — Canales de venta: integración de solo lectura, con la limitación declarada

- **Estado:** Aceptada
- **Fecha:** 2026-08-16
- **Complementa:** [ADR 0002](0002-motor-de-disponibilidad.md) · [ADR 0004](0004-tarifas-neto-rack-iva.md)

## Contexto

El hotel depende de Booking.com y el objetivo del sistema es reducir esa
dependencia sin perder el canal. La consigna era reflejar en el panel propio las
reservas entrantes, los mensajes del huésped y las reseñas.

El puerto `CanalVentaProvider` (`lib/canales/index.ts`) y sus reglas puras
(`lib/domain/canales.ts`) ya existían de una fase anterior, pero **estaban
desconectados de todo**: cero referencias fuera de sus propios tests. El diseño
estaba hecho; faltaba el cableado.

**Booking.com no tiene API pública abierta.** Hay tres caminos y sólo uno es
alcanzable hoy:

| Camino | Qué da | Por qué no / sí |
|---|---|---|
| **Connectivity API** | sincronización completa en dos direcciones | Exige ser Connectivity Partner certificado: entidad comercial, certificación técnica de ARI y reservas, compromisos de volumen. Inalcanzable para un hotel solo, y **no es un problema de código** |
| **Channel manager** (SiteMinder, Cloudbeds, RoomCloud, Octorate…) | lo mismo, más Expedia y Airbnb con una sola integración | ~USD 50-150/mes. La certificación es del proveedor. **Es una contratación del hotel**, no una decisión técnica |
| **Solo lectura**: informe CSV del extranet + feed iCal | reservas entrantes, nada más | Gratis, sin aprobación de nadie, sin credenciales |

## Decisión

### 1. Se implementa el camino de solo lectura, y se documenta el de producción

Dos formas de traer reservas, las dos detrás del puerto existente:

- **Informe CSV** (`lib/canales/csv.ts`): el «Informe de reservas» que se descarga
  del extranet (*Administración → Informe de reservas*). Trae número de reserva,
  huésped, fechas, personas, importe, comisión, estado y contacto. Es una
  **importación manual**, no un proveedor: no hay nada que sondear, hay un archivo
  que alguien sube.
- **Feed iCal** (`lib/canales/booking-ical.ts`): una URL por habitación, se puede
  leer cada hora. Trae fechas y un identificador; **nada más**.

El channel manager queda documentado como el camino de producción. El día que el
hotel lo contrate se escribe una clase que implemente `CanalVentaProvider` y se
cambia `CANAL_PROVIDER`. **El modelo de reservas no se rediseña.**

### 2. La limitación se declara en el código y se dice en pantalla

Esta es la decisión más importante del ADR.

Los dos caminos disponibles son de una sola dirección: traemos reservas pero **no
le informamos a Booking qué nos queda libre**. Consecuencia directa:

> **Booking puede vender una unidad que el mostrador ya vendió.**

La restricción de exclusión del [ADR 0002](0002-motor-de-disponibilidad.md)
protege **nuestra** base, no el inventario publicado del otro lado. El hotel tiene
que seguir cerrando fechas a mano en el extranet.

Para que eso no se pierda, el puerto ganó un descriptor de capacidades
(`CapacidadesCanal`). Antes había dos salidas y las dos malas: que
`publicarDisponibilidad` no hiciera nada y devolviera `ok: true` (mentir), o que
lanzara (romperle la operación a quien llamó). Ahora declara
`publicaDisponibilidad: false` y `ResultadoEnvio` lleva `noSoportado`, que
distingue «no puedo» de «fallé» — uno se reintenta, el otro nunca.

La pantalla de canales muestra la advertencia arriba de todo, con ícono y texto.
Sin decirlo, alguien iba a concluir que estaba cubierto porque «el sistema
sincroniza con Booking».

### 3. Staging: lo que llega no es todavía una reserva

Las reservas entrantes aterrizan en `canal_reservas` y **no ocupan inventario**
hasta que alguien las importa. Tres razones:

1. **El canal manda datos que pueden no calzar.** Booking nombra las habitaciones
   con sus propios códigos, que pueden no existir del lado nuestro.
2. **La importación puede chocar con el anti-overbooking**, y ese choque es
   información valiosa: significa que el canal sobrevendió. Queda en estado `error`
   con el motivo escrito, para resolverlo a mano. Escribiendo directo en `reservas`
   ese caso —el más importante— se habría perdido en un log.
3. **Los canales reenvían.** Guardar el evento crudo con su `external_id` da
   idempotencia y permite auditar qué mandó el canal cuando el huésped diga que
   reservó otra cosa.

### 4. El precio lo pone el hotel, siempre

El importe que informa el canal se guarda como **referencia** y se usa para
conciliar. El total se recalcula con el dominio propio a tarifa **neto**, porque
una venta por OTA es venta de agencia ([ADR 0004](0004-tarifas-neto-rack-iva.md)).
Si hay diferencia, se avisa; **nunca se ajusta el precio nuestro al del canal**.

### 5. La reserva importada entra confirmada

`estadoSegunOperacion` la deja `confirmada`, no `pendiente`. El canal ya la cerró
con el huésped. Tratarla como pendiente la expondría a la expiración automática de
la migración `0011`, que liberaría una unidad **ya vendida**.

### 6. Mensajes y reseñas: modelados, cargados a mano

Ni el CSV ni el iCal los traen (eso requiere la API de partner). Se modelan
(`canal_mensajes`, `canal_resenas`) y se cargan manualmente. Tenerlos en el sistema
es mejor que en la memoria de quien los leyó: un pedido de cuna sin atender termina
siendo una queja en la reseña.

Las reseñas se guardan en la **escala de Booking (0 a 10)** y con lo positivo y lo
negativo en campos separados, como los publica Booking. Normalizar a 5 o a 100
perdería fidelidad con lo que el huésped ve y haría imposible cotejar con el
extranet.

## Justificación

- **Da valor hoy sin depender de nadie.** No hace falta aprobación de Booking ni
  contratar un servicio para que el panel muestre las reservas del canal.
- **No hipoteca el futuro.** El puerto ya existía y absorbe el cambio: enchufar un
  channel manager es una clase nueva, no un rediseño.
- **La limitación es explícita en tres niveles**: el tipo (`capacidades()`), el
  mensaje de error (`noSoportado`) y la pantalla. Una integración parcial que se
  presenta como completa es peor que no tenerla, porque genera confianza falsa
  sobre el overbooking.
- **Los parsers son puros y están muy probados** (83 tests entre CSV e iCal). Son
  la parte que no controlamos: el separador cambia con la configuración regional,
  los encabezados con el idioma, y las fechas con las dos cosas. Ninguno de esos
  errores falla de forma visible — un día confundido con un mes da una reserva
  perfectamente plausible en la fecha equivocada.

## Consecuencias

- Aparece `CANAL_PROVIDER` (`simulado` | `booking-ical`). Por el
  [ADR 0018](0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md) es
  **obligatoria en producción**: si falta, las reservas de Booking no entrarían y
  nadie se enteraría.
- Aparece `BOOKING_ICAL_FEEDS`, con pares `CODIGO_TIPO=url`. El código del tipo va
  del lado nuestro porque **el feed no lo dice**: cada URL del extranet es una
  habitación, y qué habitación es lo sabe quien copió la URL. Es la limitación más
  incómoda del iCal y obliga a dar de alta un feed por tipo de unidad.
- Área nueva `canales` en `lib/domain/permisos.ts`, visible para **admin, gerencia
  y recepción**: importar las reservas de Booking es trabajo de mostrador, no de
  gerencia.
- Cuatro tablas nuevas, ninguna legible por `anon` (se revoca el `select` que la
  migración 0006 concede por defecto): `canal_reservas` tiene nombre, email,
  teléfono y país de huéspedes, y `canal_mensajes` lo que el huésped escribió.
- **Se corrigió un acoplamiento preexistente en `lib/pricing/cotizar.ts`.**
  Siempre creaba su propio cliente con `crearClienteServidor()`, que llama a
  `cookies()`. Eso hacía que `crearReservaEnUnidadLibre` —que recibe un cliente
  justamente para poder correr con `service_role`— quedara atada a una petición
  HTTP: no se podía crear una reserva desde un webhook, una tarea programada ni un
  test de integración, y el error (`cookies was called outside a request scope`) no
  dejaba adivinar la causa. Ahora el cliente se puede inyectar; sin pasarlo, el
  comportamiento es el de antes.
- **Nada de datos de tarjeta.** El informe de Booking no los exporta y el iCal
  menos. Hay un test que lo fija como contrato: WinPAX guardaba PAN y PIN, y este
  sistema no puede empezar a hacerlo por la puerta de una importación.

## Alternativas descartadas

- **Escribir directo en `reservas`** al recibir del canal. Descartado: el choque
  con el anti-overbooking —el caso más importante— se habría perdido en un log.
- **Ajustar nuestro total al importe del canal** para que «cierren». Descartado:
  invierte quién fija el precio (ADR 0004) y esconde justamente el problema que hay
  que ver (tarifa mal cargada, comisión distinta de la pactada, o el canal vendiendo
  a un precio viejo).
- **Un solo proveedor «booking» que combine CSV e iCal.** Descartado: el CSV es una
  subida manual de archivo y el iCal un sondeo por URL. Meterlos en el mismo método
  `traerReservas` habría forzado que uno de los dos mintiera sobre lo que hace.
- **Deducir el tipo de unidad del contenido del feed iCal.** No hay dato para
  hacerlo. Se configura, y se declara que se configura.
