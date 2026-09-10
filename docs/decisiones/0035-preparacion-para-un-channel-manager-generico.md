# ADR 0035 — Preparación para un channel manager genérico

- **Estado:** Aceptada
- **Fecha:** 2026-09-09
- **Complementa:** [ADR 0021](0021-canales-de-venta-solo-lectura.md) (la
  limitación de Booking/Expedia) y [ADR 0032](0032-el-lado-saliente-del-canal.md)
  (que deja escrito «el adapter de channel manager requiere contratarlo»)
- **Origen:** análisis de referencia contra QloApps (patrón: el módulo conector
  hacia el Channel Manager de Webkul, un servicio SaaS de terceros que el repo
  clonado no trae — solo el adaptador que le habla).

## Contexto

El pedido: preparar el sistema para que, el día que el hotel contrate un channel
manager con API abierta (Beds24, Hotelrunner, RateGain), conectarlo sea agregar
un adaptador y no reescribir el sistema. **Sin conectar nada real hoy.**

Al revisar qué ya existía, apareció un hallazgo que cambió el diseño: `lib/canales/*`
(el módulo de Booking/Expedia) **no es candidato a generalizarse**. Cinco tablas
—`canal_reservas`, `canal_sincronizaciones`, `canal_mensajes`, `canal_resenas`
(0038), `canal_config` (0049)— tienen `check (canal in ('booking', 'expedia'))`, y
la propia pantalla del panel (`app/panel/canales/page.tsx`) filtra
`.eq('canal', 'booking')` en cada consulta: hoy ese módulo es, a propósito,
de un solo canal. Y con razón: resuelve un problema concreto de Booking —su
informe CSV de reservas, el scraping de reseñas de su extranet, el iCal— que un
channel manager de verdad no tiene, porque habla por su propia API. Generalizar
esas cinco tablas habría sido reescribir un módulo que funciona, para un formato
que nadie del otro lado usaría.

Lo genuinamente reusable para un channel manager es más chico: un catálogo de
proveedores (no dos valores fijos) y un mapeo de tipos de unidad que cualquier
proveedor del catálogo pueda usar. Eso es lo nuevo de este ADR.

## Decisión

### 1. Dos tablas nuevas, no una generalización de `canal_tipos`

`canales_externos` (catálogo: código, nombre, activo, token) y
`canal_externo_tipos` (tipo de unidad ↔ código con el que ESE proveedor lo
conoce) — migración 0094. Agregar un proveedor el día de mañana es un `INSERT`,
no una migración: la diferencia concreta con `canal_tipos` (0081), que sigue
atada a los dos valores fijos de siempre porque sigue resolviendo el problema de
Booking/Expedia, no éste.

### 2. `reservas.canal` sigue siendo una lista chica y curada — a propósito

`reservas_canal_valido` (0062) fija esa columna a la lista exacta de `CANALES`
porque es la dimensión de `resumen_canal_mes` y de la conciliación de
comisiones; un CHECK más ancho que el dominio no protege de nada. En vez de
pelear contra esa decisión (correcta), se le sumó **un** valor genérico —
`channel_manager` (migración 0095)— que agrupa a CUALQUIER proveedor conectado
por acá. Cuál proveedor fue puntualmente no vive en `canal`: vive en el prefijo
de `reservas.voucher` (`<codigo_del_proveedor>:<referencia_externa>`). Si algún
día un proveedor puntual necesita su propia fila en los reportes de comisión,
esa es la migración chica que ya preveía la 0062 — no antes de tener uno
contratado.

### 3. El webhook crea la reserva de una, no la deja en una cola

`lib/canales/servicio.ts` (Booking) deja lo importado en `canal_reservas` para
que recepción lo revise antes de convertirlo en una reserva real — tiene
sentido ahí porque el CSV es información de segunda mano y de una vez por día.
Un channel manager real avisa la venta apenas ocurre, así que
`POST /api/canales/externos/<token>` llama directo a
`crearReservaEnUnidadLibre` (`lib/reservas/crear.ts`) — el mismo helper que ya
usan el portal público y el alta de mostrador. No es lógica nueva: es la prueba
de que la lógica de descuento de inventario ya era agnóstica al origen.

### 4. Idempotencia por `referencia_externa`, igual que las pasarelas

`referencia_externa` es obligatoria en el payload y se guarda (con el prefijo
del proveedor) en `voucher`. Un reintento de red con la misma referencia
devuelve la reserva ya creada en vez de duplicarla — mismo problema que
resuelve `pagos.external_id` (único) para MercadoPago/Stripe, resuelto acá a
mano porque `voucher` no es único a nivel de base (también lo usa una reserva
de mostrador).

### 5. Token al portador en la URL, 404 y no 401 ante uno inválido

Mismo patrón que el feed iCal de salida (`/api/canales/ical/<token>`) y el
portal de socios: el otro lado es un servidor sin sesión. Un 401 confirmaría
que la ruta existe; un 404 no distingue «no existe» de «el token está mal».

### 6. Una unidad que ya no está libre es un 409, no un 500

Es el overbooking real que las advertencias de `capacidades()` describen desde
el ADR 0021: el channel manager cree que vendió algo que acá ya no está
disponible. Se responde 409 (conflicto real, no error transitorio) y se
registra en `errores` para resolverlo a mano con el huésped — no se lo esconde
detrás de un 500 genérico.

## Consecuencias

**A favor**

- Conectar un proveedor real es un `INSERT` en `canales_externos` + su mapeo,
  no una migración ni tocar el webhook.
- La lógica de inventario queda demostrada, no solo declarada, como agnóstica
  al origen: portal, mostrador y canal externo pasan por el mismo helper.
- `resumen_canal_mes`/conciliación de comisiones no se ensucian con un valor
  por proveedor hasta que haga falta de verdad.

**En contra, y asumido**

- **No hay ningún proveedor real conectado.** Es preparación, tal como pedía
  el encargo — no probado contra Beds24/Hotelrunner/RateGain, solo contra el
  contrato del payload que este sistema define.
- **Sin pantalla de administración.** Cargar `canales_externos` y su mapeo hoy
  es por Studio/SQL. Construir el CRUD antes de tener un proveedor real sería
  diseñar una pantalla para un formulario que todavía no se sabe si hace
  falta — se hace cuando se contrate el primero (mismo criterio que
  `docs_fiscales`: no se siembra un dato que nadie puede verificar todavía).
- **Un solo webhook de entrada.** No hay lado de salida (el canal externo no
  recibe ARI de este sistema); si el proveedor lo requiere, es una extensión
  futura sobre el mismo catálogo.
