# Modernización WinPAX — plan de trabajo y estado

**Arranque:** 2026-08-16 · **Rama:** `audit/fase-1-seguridad-critica`

> **Para qué es este archivo.** El cliente venía de **WinPAX** (Oracle Forms, ~año 2000) y el
> objetivo es cubrir sus funciones core con experiencia web moderna. El pedido son 11 pasos que
> no entran en una sesión: este documento es la lista viva, para que **no se pierda nada** si se
> compacta el contexto o se corta la sesión.
>
> **Cómo se mantiene:** al terminar cada paso se marca acá, con las rutas tocadas y los tests que
> lo cubren. Si un paso descubre algo que hay que arreglar después, va a *Deuda descubierta*.

---

## Reglas que este trabajo NO puede violar

Salieron del recorrido inicial del repo. Cada una tiene su razón.

1. **Nunca guardar datos de tarjeta.** WinPAX guardaba PAN, vencimiento, autorización y PIN.
   Este sistema **no guarda nada de eso** en ninguna tabla (`pagos` tiene sólo `medio`, `monto`,
   `estado` y el `external_id` de la pasarela). No hay nada que migrar: el trabajo es *no
   agregarlo*. El riesgo real es que alguien pegue un número de tarjeta en `pagos.nota` o
   `reservas.notas` por costumbre de WinPAX — eso se mitiga validando la entrada.
2. **`estadias.huespedes` alimenta el motor anti-overbooking** (ADR 0002) y las validaciones de
   capacidad. Tocar esa columna exige mirar `lib/domain/*` y `tests/capacidad.test.ts` primero.
3. **`alter type ... add value` y el primer uso de ese valor van en migraciones separadas.**
   SQLSTATE 55P04; el `db reset` corta ahí y no aplica nada de lo que sigue (ver `0032` + `0035`).
   Afecta al paso 8, que toca el enum `categoria_producto`.
4. **Toda escritura revisa `{ error }`** — `return { error }`, `cortarSiFalla` o `registrarFalla`
   (Fase 20, hoy hay cero descartados y conviene que siga así).
5. **Prohibido `<details>`** para esconder acciones o formularios; alta y edición en pantalla
   propia; toda etiqueta visible (Fase 15).
6. **`npm run check` en verde antes de decir que un paso terminó.**

## Cinco colisiones de nombres (leer antes de nombrar algo nuevo)

Varios módulos del checklist **parecen** existir y son otra cosa:

| Nombre ya tomado | Qué es realmente | Qué NO es |
|---|---|---|
| tabla `canales` (0019) | canales de **chat interno** del staff | canales de venta / OTA |
| tabla `puntos_venta` (0025) | punto de venta **fiscal**, numera facturas | POS de frigobar |
| `lib/domain/cuenta.ts` | validación de **cambio de contraseña** | cuenta corriente del huésped |
| `lib/domain/moneda.ts` | **formateo** de importes (`USD 145,20`) | tipo de cambio |
| `lib/pricing/cotizar.ts`, `0008_cotizacion.sql` | cotizar una **estadía** (precio) | cotización de moneda |

Por eso el paso 1 se llama **divisas** y no «cotización», y el paso 7 no puede llamarse
`puntos_venta`.

---

## Estado de los 11 pasos

| # | Paso | Estado | Toca esquema | Toca código existente |
|---|---|---|---|---|
| 1 | Cotización de divisas (cierra ADR 0003) | ✅ | tabla nueva | dashboard + config |
| 2 | Grilla: fila resumen + accesibilidad | ✅ | no | `ocupacion/page.tsx` |
| 3 | Toggles operativos del listado de reservas | ✅ | `estadias` (+2 generadas) | listado + export CSV |
| 4 | Canales: enchufar el puerto + CSV de Booking | ✅ | 4 tablas nuevas | puerto + cotizar.ts |
| 5 | Canal iCal de Booking | ✅ | no | no |
| 6 | Ficha de reserva completa | ✅ | `reservas`, `estadias`, `huespedes` + RPC | alta, detalle, listado, CSV |
| 7 | POS con grilla, buscador y comanda | ✅ | `consumos` (+3 col) + secuencia | no |
| 8 | Folio A/B, departamentos y split | ✅ | tabla nueva + `consumos`, `reservas`, `productos` | detalle + POS |
| 9 | Housekeeping móvil para mucamas | ✅ | no | tablero HK |
| 10 | Piso/bloque + acciones rápidas en la grilla | ✅ | `unidades` (+3 col) | grilla + config + mant. |
| 11 | Respaldos verificables | ✅ | tabla nueva | no |

Leyenda: ⬜ pendiente · 🔨 en curso · ✅ terminado con `npm run check` verde

**Los 11 pasos están terminados.** `npm run check` exit 0 · **882 tests, cero salteados**, contra
la base local con las tres variables exportadas. 8 migraciones nuevas (`0036`–`0043`), todas
aplicadas y verificadas con `npx supabase migration up --local`.

---

## Paso 1 — Cotización de divisas ✅

**Terminado el 2026-08-16.** `npm run check` exit 0 · 62 tests nuevos.

**Cierra el ADR 0003**, que en julio decidió «USD base + ARS a cotización configurable» y dejó
anotado *«Hace falta un mecanismo para cargar/actualizar la cotización»*. Nunca se hizo: hasta
hoy el sistema no sabía convertir nada.

- [x] `lib/domain/divisas.ts` — puro: validación, frescura, conversión, resolución de la vigente
- [x] `tests/divisas.test.ts` — 38 tests
- [x] `lib/divisas/index.ts` — adapter `CotizacionProvider` (DolarAPI, ArgentinaDatos, manual)
- [x] `tests/divisas-proveedor.test.ts` — 24 tests del borde externo (ceros, 500, timeout, HTML)
- [x] `lib/divisas/servicio.ts` — cadena de respaldo: caché → fuente → base → USD
- [x] Migración `0036_cotizaciones_de_divisas.sql`
- [x] `app/api/cotizacion/route.ts` — endpoint interno, con sesión obligatoria
- [x] Widget en el dashboard (en `Suspense`) + carga manual en `app/panel/config#divisas`
- [x] Icono `divisas` en `iconos.tsx` (aditivo)
- [x] [ADR 0020](decisiones/0020-cotizacion-de-divisas.md)

**Variables de entorno nuevas:** `COTIZACION_PROVIDER` (**obligatoria en producción**
por ADR 0018), `DOLARAPI_URL` y `ARGENTINADATOS_URL` (opcionales, para apuntar a un
proxy).

**Decisiones fijadas y por qué:**

- **Se cobra al valor de VENTA.** Lo dice el Tarifario («cotización oficial de venta billete del
  Banco Nación del día de pago») y además el hotel compra al precio de venta los dólares que va a
  rendir. Usar el de compra le regala el spread a cada huésped que pague en pesos.
- **El USD nunca se convierte.** Es la moneda base (ADR 0003).
- **Una cotización vencida se usa igual, avisando.** Si la API de terceros se cae un sábado, la
  alternativa a cobrar con el valor de la mañana es *no poder cobrar*. Hay dos umbrales:
  30 min (refrescar) y 12 h (avisarle a quien cobra). **Nunca bloquea una operación.**
- **Un valor manual reciente le gana a uno automático viejo.** Gana la más fresca sin privilegiar
  fuente: la carga manual es una corrección deliberada de alguien mirando el pizarrón del banco.
- **Tres monedas** (ARS, BRL, EUR): El Calafate recibe turismo brasileño y europeo. No más de las
  que el hotel usa — cada una es una fila que alguien mantiene a mano cuando la API no responde.

## Paso 2 — Grilla de ocupación ✅

**Terminado el 2026-08-16.** `npm run check` exit 0 · 20 tests nuevos.

La grilla Gantt ya existía y estaba bien hecha (`app/panel/ocupacion/page.tsx`): unidades en
filas, días en columnas, barras por estado, ventana 14/30, celda libre → reserva.

- [x] `lib/domain/grilla.ts` — `resumenPorDia`, `totalesDeVentana`, `tonoOcupacion`, `claveEstado`
- [x] `tests/grilla.test.ts` — 20 tests
- [x] **Fila resumen por día** en `<tfoot>` pegado abajo: ocupadas, libres, llegadas, salidas,
      pax, % ocupación
- [x] **Accesibilidad**: cada estado lleva **letra + color** (`P` pendiente, `C` confirmada,
      `$` pagada, `H` in-house), texto `sr-only` por celda y la referencia al pie con las letras
- [x] Indicadores de arriba recalculados desde la **misma** cuenta que la fila de abajo

**Decisiones y trampas:**

- **La noche del check-out no cuenta como ocupada.** Los períodos son `[desde, hasta)`: del 10
  al 13 son tres noches y el 13 la unidad está libre. Contarla al revés es el error clásico de
  esta grilla e infla la ocupación tanto como la rotación del hotel. Hay test.
- **Los indicadores de arriba salen de `totalesDeVentana(resumen)`**, no de una cuenta paralela.
  Antes se calculaban a mano en la página; con dos cuentas era cuestión de tiempo que mostraran
  números que no cerraran y el usuario no supiera cuál creer.
- **El indicador «Libres hoy» se adapta**: si el usuario navegó a otro mes, hoy no está en la
  ventana, así que muestra el primer día visible con su fecha. Antes hubiera dicho «hoy» sobre
  un día fuera de pantalla.
- **Los tramos de color del % son de negocio**: 100 % completo, ≥ 85 % dejar de dar descuentos.
- El resumen sólo cuenta las **unidades visibles**: filtrado por cabañas, la ocupación es la de
  las cabañas.
- Se agregó `huespedes` al `select` de `estadias` (hacía falta para el pax). Es una columna más
  en una consulta que ya se hacía; no cambia el esquema.

## Paso 3 — Toggles operativos del listado ✅

**Terminado el 2026-08-16.** `npm run check` exit 0 · 32 tests nuevos (12 contra Postgres real).

- [x] Migración `0037_estadias_fechas_consultables.sql` — `check_in`/`check_out` **generadas**
- [x] `lib/domain/vistas-reservas.ts` — las 10 vistas con su definición de negocio
- [x] Chips: **En el hotel · Llegadas hoy · Salidas hoy · Pendientes · Confirmadas · Check-out ·
      No-show · Canceladas · Grupos · Particulares**
- [x] Columna de **saldo** (reusa `resumenPagos`, no se duplicó el cálculo) + totales al pie
- [x] Estado vacío que dice el hecho operativo («no hay llegadas previstas para hoy»)
- [x] Export CSV alineado: viaja la vista y suma columnas Pagado/Saldo
- [x] `tests/vistas-reservas.test.ts` (20) + `tests/vistas-reservas-consulta.test.ts` (12, con base)

**Por qué hacía falta una migración para esto.** `estadias.periodo` es un `daterange` —correcto,
es lo que hace posible la exclusión GiST del ADR 0002— pero PostgREST no expone `lower()`. «Las
que llegan hoy» había que escribirlo con operadores de rango negados:
`periodo=nxl.[hoy,hoy] & periodo=not.nxl.[mañana,mañana]`. Funciona y es ilegible; un signo
cambiado da un resultado plausible y equivocado. Las columnas son **generadas**, así que no se
pueden escribir y **no pueden desincronizarse** de `periodo` (hay test).

**La trampa que casi se me pasa, y que el test de integración cubre:** un filtro sobre tabla
embebida (`estadias.check_in`) sólo acota la fila madre si el embed es `!inner`. Con un embed
normal PostgREST devuelve **todas** las reservas con el array vacío — un filtro que no filtra y
no falla. El test «Llegadas hoy NO trae a quien entró ayer» es el que lo detecta.

**Decisiones de negocio de las vistas:**

- **«En el hotel» es `estado = in_house`, no una consulta por fecha.** Que las fechas incluyan hoy
  significa que la persona *tendría* que estar; que esté lo marca el check-in. Distinguir «está
  alojado» de «no apareció» es justo lo que recepción necesita.
- **«Llegadas hoy» incluye a quien ya se registró** (es la planilla del día) y **excluye canceladas
  y no-show** (no van a llegar; mostrarlas obliga a leer la columna de estado para saber a quién
  esperar). Simétrico en «Salidas hoy» con `checkout`.
- **«Particular» = sin grupo Y sin agencia.** Quien vino por agencia no es particular aunque haya
  venido solo.
- **Vista y chip de estado se limpian mutuamente**: aplicar los dos puede dar vacío sin que se
  entienda por qué.
- **Los totales del pie son de la página, y lo dice.** Sumar el resultado completo exigiría traer
  todas las filas — justo lo que la paginación evita, y `max_rows` cortaría en 1000 sin avisar.

**Diferido al paso 6** (necesitan columnas nuevas en `reservas`, que es donde se tocan igual):

- **Tarifa con/sin impuestos.** `reservas.total` se guarda **con IVA** y `tarifas.iva_pct` puede
  variar por tarifa, así que el neto no se puede recuperar del total sin recalcular. Se resuelve
  guardando el desglose (subtotal / descuento / IVA), que el paso 6 agrega de todos modos.
- **Filtros por garantía, segmento y pensión**: esas columnas no existen todavía.

## Paso 4 y 5 — Canales / Booking

**Hallazgo clave: el puerto existe y está desconectado de todo.** `lib/canales/index.ts`
(`CanalVentaProvider` + simulador) y `lib/domain/canales.ts` (reglas puras, 19 tests) tienen
**cero referencias** fuera de sus propios tests. El diseño está hecho; falta el cableado.

Ya fijado por esos módulos: OTA va a tarifa **neto** (ADR 0004), entra como **confirmada** (no
pendiente, o la expiración automática liberaría una unidad ya vendida), idempotencia por
`externalId`, y el canal **nunca** fija el precio de nuestra base.

**Los tres caminos a Booking, evaluados:**

1. **Connectivity API directa — descartada.** Exige entidad comercial, certificación técnica de
   ARI + reservas y compromisos de volumen. No es alcanzable para un hotel en el plazo de la
   tesis, y no es un problema de código.
2. **Channel manager (SiteMinder, Cloudbeds, RoomCloud, Octorate) — el camino de producción.**
   Sincronización real en dos direcciones, una integración cubre Booking + Expedia + Airbnb, la
   certificación es del proveedor. ~USD 50-150/mes. **Es una decisión del hotel, no del código.**
3. **Solo lectura, sin aprobación de nadie — lo que se implementa acá:**
   - **CSV** del Informe de reservas del extranet: trae nombre, importes, comisión, estado.
   - **iCal** por habitación: trae fechas y una referencia. Sin tarifas ni contacto.

⚠️ **Ninguna de las dos evita el overbooking**: son de solo lectura, nadie le empuja el cupo a
Booking. Hay que decirlo en pantalla o alguien va a creer que está cubierto.

⚠️ **El puerto necesita un descriptor de capacidades**: declara `publicarDisponibilidad()` y
`confirmarRecepcion()`, que un provider de solo lectura no puede cumplir. Si los deja como no-op
miente; si lanza, rompe al llamador.

### Estado: ✅ terminado el 2026-08-16 · 118 tests nuevos

- [x] Migración `0038_canales_de_venta.sql` — 4 tablas: `canal_reservas`,
      `canal_sincronizaciones`, `canal_mensajes`, `canal_resenas`. Ninguna legible por `anon`
- [x] Descriptor `CapacidadesCanal` + `ResultadoEnvio.noSoportado` en el puerto
- [x] `lib/canales/csv.ts` — lector del informe del extranet (50 tests)
- [x] `lib/canales/ical.ts` + `booking-ical.ts` — feed iCal (33 + 20 tests)
- [x] `lib/canales/servicio.ts` — aterrizar e importar (15 tests contra Postgres)
- [x] `app/panel/canales` — entrantes, mensajes y reseñas, con la advertencia de overbooking
- [x] Área `canales` en permisos (admin, gerencia, **recepción**), navegación, icono y ayuda
- [x] [ADR 0021](decisiones/0021-canales-de-venta-solo-lectura.md)

**Variables nuevas:** `CANAL_PROVIDER` (`simulado` | `booking-ical`, obligatoria en producción)
y `BOOKING_ICAL_FEEDS` con pares `CODIGO_TIPO=url`.

**Lo que se decidió y por qué (el detalle está en el ADR):**

- **Staging, no escritura directa.** Lo que llega aterriza en `canal_reservas` y **no ocupa
  inventario** hasta que alguien lo importa. Es lo que hace que el choque con el anti-overbooking
  sea **visible**: si el canal sobrevendió, la fila queda en `error` con el motivo escrito en vez
  de perderse en un log. Hay un test dedicado a ese caso.
- **El precio lo pone el hotel.** El importe del canal es referencia para conciliar; el total se
  recalcula a tarifa neto (ADR 0004). Si difiere, se avisa — nunca se ajusta.
- **La importada entra `confirmada`**, no pendiente: si no, la expiración automática de la 0011
  la borraría en 5 días y liberaría una unidad ya vendida.
- **El CSV no es un provider.** Es una subida manual de archivo; el iCal sí es un sondeo. Meterlos
  en el mismo `traerReservas` habría forzado que uno mintiera sobre lo que hace.
- **Se buscan huéspedes sólo por email.** Por apellido se fusionarían dos personas distintas, que
  es peor que tener dos fichas de la misma.

**Trampas que aparecieron y quedaron cubiertas por tests:**

- El separador del CSV es **punto y coma** cuando Excel exporta en español. Asumir coma no falla:
  devuelve columnas vacías.
- `10/09/2026` es el 10 de septiembre o el 9 de octubre y **no se puede resolver mirando el
  archivo**. Se asume día/mes y la pantalla **advierte** cuántas fechas eran ambiguas.
- `1.234,56` y `1,234.56` son el mismo número; leerlo mal es un factor de mil.
- En iCal, el espacio inicial de una línea de continuación **es el marcador de plegado** y se
  descarta (RFC 5545 §3.1). Para un espacio real hacen falta dos.
- **`DTEND` de iCal ya es exclusivo** y coincide con nuestro `[desde, hasta)`. Restarle un día
  —el reflejo natural— dejaría todas las estadías una noche cortas.
- Un estado desconocido del canal cae en `nueva`, no en `cancelada`: interpretarlo mal liberaría
  una unidad vendida.

**Bug preexistente corregido de paso:** `lib/pricing/cotizar.ts` siempre creaba su propio cliente
con `cookies()`, así que `crearReservaEnUnidadLibre` —que recibe un cliente justamente para poder
correr con `service_role`— quedaba atada a una petición HTTP. No se podía crear una reserva desde
un webhook, un cron ni un test, y el error no dejaba adivinar la causa. Ahora el cliente se
inyecta; sin pasarlo, el comportamiento es el de antes.

## Paso 6 — Ficha de reserva completa ✅

**Terminado el 2026-08-16.** `npm run check` exit 0 · 36 tests nuevos (12 contra Postgres).

### El diff que había que mostrar, y qué podía romper

Migración `0039_ficha_de_reserva_completa.sql`. Tocó tres tablas y **reemplazó
`crear_reserva`**, que es la función más crítica del sistema.

| Qué se tocó | Riesgo | Cómo quedó verificado |
|---|---|---|
| `huespedes` + `vip` | ninguno, columna nueva con default | test |
| `reservas` + 9 columnas | ninguna existente cambió; `total` sigue siendo el importe **con IVA** | 786 tests |
| `estadias` + 6 columnas | **acá estaba el riesgo**: alimenta el anti-overbooking | ver abajo |
| `crear_reserva` reemplazada | `drop` + `create`, no `replace` | 1 sola versión en `pg_proc`, verificado |

**Lo que podía romper y no rompió:**

1. **La exclusión GiST del ADR 0002.** Verificado que sigue en `pg_constraint` y que
   `crear_reserva` sigue abortando toda la operación con SQLSTATE `23P01` sin dejar reserva
   huérfana. Hay test.
2. **Sobrecarga de la función.** `create or replace` con una lista de argumentos distinta habría
   creado una **segunda** función, y una llamada por nombre podría haberse resuelto a la
   equivocada. Se usó `drop` + `create` y se verificó que `pg_proc` tenga exactamente una.
3. **Las llamadas existentes.** Los parámetros nuevos van al final, todos con default, y las dos
   llamadas del sistema pasan argumentos con nombre. No cambió ninguna.
4. **`returns reservas`.** Devuelve el tipo de fila completo, así que las 9 columnas nuevas
   aparecen automáticamente sin tocar nada.

### La decisión discutible, explicada

**No se agregó `check (adultos + menores = huespedes)`.** Sería un invariante lindo y una trampa:
los `update` de mudanza (0028) y reprogramación tocan la unidad y el período sin mirar el pax, y
cualquier `insert` directo futuro con sólo `huespedes` fallaría con un error que no explica nada.

En su lugar, **`crear_reserva` deriva `huespedes` del desglose** (`adultos + menores`). Como es el
**único** lugar donde nacen estadías —lo usan el panel, el portal público y la importación de
canales— la coherencia queda garantizada en el origen. `desgloseCoincide()` es la red de
seguridad: la ficha avisa en pantalla si una fila vieja no cierra, en vez de mostrar dos números
contradictorios en silencio.

**Los bebés no suman al pax.** Una cabaña para 4 con 2 adultos + 1 menor + 2 bebés ocupa 3 plazas.
Si sumaran, el sistema rechazaría esa reserva perfectamente válida. Hay test dedicado.

**Las camas extra amplían la capacidad**: una doble con cama extra entra 3. Sin sumarlas, la cama
extra no serviría para nada.

### Lo implementado

- [x] `lib/domain/ocupantes.ts` — pax, validación contra capacidad, texto para pantalla
- [x] `lib/domain/reservas.ts` — planes, garantías, segmentos, `noShowEsCobrable`, `segmentoDeCanal`
- [x] `tests/ocupantes.test.ts` (24) + `tests/ficha-reserva.test.ts` (12, con base)
- [x] Alta: dos pasos nuevos en el formulario (ocupantes y condiciones comerciales)
- [x] Detalle: desglose de ocupantes, VIP, plan, garantía, segmento, voucher y **desglose fiscal**
- [x] Aviso de **«no mover»** en la pantalla de cambio de unidad, que es donde ese dato sirve
- [x] Listado: filtros por plan, garantía y segmento + **interruptor con/sin IVA** + estrella VIP
- [x] Export CSV: plan, garantía, segmento, neto, IVA y total

**Cierra lo que el paso 3 había diferido:** la tarifa con/sin impuestos y los filtros por
garantía, segmento y pensión. Ahora se puede porque las columnas existen — antes el neto no se
podía recuperar del total, ya que `tarifas.iva_pct` puede variar por tarifa y dividir por 1,21
daba un número aproximado y silenciosamente equivocado.

**Lo que NO se agregó, y no es un olvido:** los datos de tarjeta de WinPAX (número, vencimiento,
autorización, **PIN**). Ver la regla 1 arriba.

**Queda pendiente:** el estado `preautorización` no existe (hay 7 estados; `pendiente` cubre
parte). Agregarlo toca el enum `estado_reserva` y por lo tanto exige **dos migraciones** (regla 3).
No se hizo porque `garantia` cubre el caso de uso real —saber si hay de dónde cobrar— sin tocar el
enum del que dependen la exclusión GiST y el trigger de sincronización de estados.

## Detalle original del paso 6 (**mostrar diff**)

Están: huésped, fechas, noches, tipo y número de habitación, cantidad de habitaciones (grupales),
canal, agencia, neto/rack, moneda, total, notas internas, política de cancelación, promoción, y el
ciclo completo (cancelar, reprogramar, cambiar de unidad — migración 0028).

Faltan: **VIP**, **adultos/menores/bebés** (hoy `estadias.huespedes` es un `int` plano),
**cama extra**, **cunas**, **plan** (habitación y desayuno), **«no mover»**, **voucher**,
**descuento % y subtotal por reserva** (existe `agencias.descuento_pct`, no por reserva),
**contrato o tarifa especial ligado a la reserva**.

El estado `preautorización` no existe (hay 7 estados; `pendiente` cubre parte). El depósito está
cubierto por `pagos.tipo = 'senia'`.

⚠️ Ver regla 2: `estadias.huespedes` toca el anti-overbooking.

## Paso 7 — POS ✅

**Terminado el 2026-08-16.** `npm run check` exit 0 · 22 tests nuevos.

- [x] Migración `0040_comandas_punto_de_venta.sql` — `comanda`, `punto` y `nota` en `consumos`,
      más la secuencia `comandas_numero_seq` y la función `siguiente_comanda()`
- [x] `lib/domain/punto-venta.ts` — totales, validación de stock, buscador sin acentos
- [x] `tests/punto-venta.test.ts` — 22 tests
- [x] `app/panel/punto-venta` — grilla por departamento, buscador, total en vivo, comandas recientes
- [x] Área `punto_venta` en permisos (admin, gerencia, recepción), navegación y ayuda

**Por qué NO se creó una tabla `comandas`.** Sería duplicar `consumos`, que ya tiene producto,
cantidad, precio con snapshot y **ya impacta en la cuenta del huésped** por un camino probado. Una
comanda no es una entidad con vida propia: es un agrupador de líneas cargadas juntas, y para eso
alcanza un número compartido. Así no hay dos caminos por los que un consumo llegue a la cuenta.

**Decisiones:**

- **Los precios NO viajan en el formulario.** La acción los lee del catálogo. Si viniera del
  formulario, cualquiera se cargaría un vino a USD 0 editando el HTML.
- **Un solo `insert` con todas las líneas**: o entran todas o ninguna. Media comanda en la cuenta
  es peor que una comanda rechazada, porque hay que descubrirla para corregirla.
- **El número se pide después de validar**, para no consumir números en comandas rechazadas.
- **Es una secuencia, no un contador en tabla.** Admite huecos a propósito — es lo contrario de la
  numeración de facturas (0025/0033), que no puede tenerlos por exigencia fiscal.
- **El descuento de stock va con `registrarFalla`, no corta.** El consumo ya está en la cuenta; si
  el stock no baja el inventario queda mal (corregible), pero cortar dejaría a quien cargó creyendo
  que la comanda no entró cuando sí entró.
- **Anular no repone stock.** La botella igual salió del frigobar; lo que se corrige es a quién se
  le cobra.

## Detalle original del paso 7 — POS

Hoy el cargo de consumos se hace desde el detalle de la reserva con un `<select>` + cantidad, y
**sí** impacta la cuenta. Falta la pantalla de verdad: **grilla por departamento**, **buscador**,
**número de comanda**, varias líneas de una vez.

⚠️ No llamarlo `puntos_venta` (ya existe, es fiscal).

## Paso 8 — Folio A/B, departamentos y split ✅

**Terminado el 2026-08-16.** `npm run check` exit 0 · 28 tests nuevos.

### La trampa del enum se esquivó: fue UNA migración, no dos

El plan decía que este paso exigía dos migraciones por el SQLSTATE 55P04 (`alter type ... add
value` y el primer uso del valor no pueden ir juntos). **No hizo falta tocar el enum.**

El departamento/subdepartamento de WinPAX es una **jerarquía**, y un enum plano no la representa
por más valores que se le agreguen. Va en una tabla, que además la puede editar el hotel sin una
migración por sector nuevo, y deja `categoria_producto` intacto. La regla 3 sigue vigente para el
futuro, pero acá no aplicaba.

- [x] Migración `0041_folios_y_departamentos.sql` — tabla `departamentos` (jerarquía de **dos
      niveles**, con trigger que rechaza el tercero), `folio`/`comprobante`/`departamento_id` y
      moneda de origen en `consumos`, `folio_alojamiento` y titular del folio B en `reservas`
- [x] `lib/domain/folios.ts` — totales por folio, agrupación por departamento, split, invariante
- [x] `tests/folios.test.ts` — 28 tests
- [x] `app/panel/reservas/[id]/cuenta` — detalle por departamento, dos folios, split línea por
      línea, anticipos, cargo manual multimoneda
- [x] El POS graba el departamento del producto en cada línea

### La invariante y por qué se vigila en pantalla

**La suma de los folios es igual al total general.** Un cargo está en exactamente un folio; el
split reparte, no crea ni destruye. `totalesDeCuenta` calcula el total sobre **todas** las líneas y
no sumando los folios, a propósito: si una línea tuviera un folio inválido quedaría afuera de los
folios pero dentro del total, y la diferencia se ve. Sumar los folios la habría escondido.
`foliosCierran()` lo comprueba y la pantalla avisa arriba con «no factures hasta revisarlo».

### Decisiones

- **Dos folios, no cinco.** Es el caso real (la empresa paga la habitación, el huésped sus
  consumos). Cada folio extra multiplica pantallas, totales y caminos de facturación.
- **La jerarquía se frena en dos niveles**, con trigger. Un árbol de profundidad arbitraria pediría
  consultas recursivas en la cuenta y el hotel no tiene ninguna estructura que lo necesite.
- **El departamento se copia en la línea, no se deriva del producto al consultar.** Si mañana el
  producto cambia de sector, la línea ya cobrada tiene que seguir diciendo dónde se vendió.
- **`precio_unitario` sigue siempre en USD** (ADR 0003). Un cargo en pesos guarda además la moneda
  de origen, el importe original y **la cotización usada** — trazabilidad que el ADR 0003 pide
  explícitamente.
- **Un cargo en moneda extranjera sin cotización se rechaza.** Es la única operación del sistema
  donde una cotización ausente bloquea algo, y es correcto: el número en dólares no existe sin
  ella. Cargar en USD sigue funcionando siempre.
- **El saldo de un folio nunca es negativo.** Si alguien pagó de más, es un asunto de devolución;
  un negativo que después se resta del otro folio descuadra la cuenta entera.
- **Un anticipo no se mueve de folio**: está imputado al pago con que se cobró.
- **El folio B se oculta si está vacío.** Mostrarlo sería agregar una columna de ceros a todas las
  reservas para el caso minoritario.
- **La cuenta detallada es una pantalla aparte.** El detalle de la reserva ya tiene 700 líneas y su
  cuenta consolidada alcanza para el día a día; esto es la vista de administración.
- **El cargo manual apunta a un producto reservado** (`CARGO-MANUAL`, creado la primera vez que se
  usa) porque `consumos.producto_id` tiene FK obligatoria. Hacerla nullable habría roto las
  consultas que hoy asumen que hay producto.

## Detalle original del paso 8 (**mostrar diff**)

Existe la cuenta consolidada (`lib/domain/consumos.ts`), los consumos con snapshot de precio, y el
gancho AFIP completo: columnas CAE, numeración correlativa (0025/0033), ADR 0012 y el adapter
`FacturacionElectronicaProvider`.

Faltan: **departamento/subdepartamento** (hoy `categoria_producto` es un enum plano de 5 valores,
sin jerarquía), **folio A / folio B**, **split de cuenta**, **cargos en otras monedas**, anticipo
como línea explícita.

⚠️ Ver regla 3: el enum exige **dos migraciones**.

## Paso 9 — Housekeeping móvil ✅

**Terminado el 2026-08-16.** 24 tests nuevos.

- [x] `lib/domain/housekeeping.ts` — prioridad, contadores por mucama, avance del turno
- [x] `tests/housekeeping.test.ts` — 24 tests
- [x] `app/panel/housekeeping/mi-trabajo` — una tarjeta por habitación, ordenadas por prioridad,
      un botón grande por tarjeta
- [x] Fila de contexto en el tablero de admin: **faltan por hacer (con urgentes) · llegadas hoy ·
      salidas hoy · en reparación**
- [x] Acción `marcarLimpiaDesdeMovil`, separada de `cambiarEstadoUnidad`
- [x] Seis pasos nuevos en el capítulo de ayuda de housekeeping

**La regla que aporta el paso: la prioridad.** «Sucia» no significa lo mismo si esa habitación
tiene una llegada hoy a las 15:00. Antes el orden de limpieza lo decidía quien se acordara de
mirar la planilla de llegadas.

- **Sucia + llega hoy → urgente.** Es el único caso con consecuencia visible para el huésped.
- **Sucia + salió hoy → alta.** Hay que prepararla, pero nadie la está esperando todavía.
- **Bloqueada o en reparación → sin tarea**, aunque llegue alguien hoy: mandar a limpiar una
  habitación con una cañería rota es hacerle perder el viaje. Si además hay una llegada, el
  problema es de recepción.
- **El motivo se escribe al lado.** «Urgente» sin motivo no dice qué hacer; con «llega alguien
  hoy» se entiende sin preguntar.

**Decisiones:**

- **La mucama NO puede inspeccionar.** Desde el móvil sólo hace sucia → limpia, y el destino lo
  decide el dominio, no el formulario. Si pudiera mandar `inspeccionada`, el control de calidad lo
  firmaría quien hizo el trabajo.
- **Una mucama sólo cierra lo suyo.** Admin y gerencia pueden cerrar cualquiera (la gobernanta a
  veces termina una habitación); una mucama no puede marcar la de otra.
- **Las faltantes no incluyen las bloqueadas**, y el avance las descuenta del denominador. Si no,
  el turno nunca cerraría en cero ni el avance llegaría a 100 %, y los dos números dejarían de
  significar algo.
- **Tarjetas, no tabla.** Una tabla en el teléfono obliga a desplazarse de costado, que este
  proyecto prohíbe.
- **Orden numérico dentro de la prioridad**: «9» antes que «102», que es el recorrido del pasillo.

## Paso 10 — Piso, bloque y acciones rápidas ✅

**Terminado el 2026-08-16.**

- [x] Migración `0042_unidades_piso_y_bloque.sql` — `piso`, `bloque` y `orden` en `unidades`, con
      clasificación inicial por categoría (Hostería / Cabañas)
- [x] Filtros de la grilla por **bloque** (chips) y por **piso** + estado de limpieza (formulario)
- [x] Orden de la grilla por recorrido físico: bloque → piso → orden → nombre
- [x] Acciones rápidas en la columna de la unidad: limpieza y reportar desperfecto
- [x] `mantenimiento/nueva?unidad=…` preselecciona la unidad (sin esto la acción no ahorraba nada)
- [x] Sección en Configuración para cargar bloque, piso y orden

**Decisiones:**

- **`piso` y `bloque` son texto, no números ni enums.** «PB», «Entrepiso» no son números; y un enum
  exigiría una migración por cada sector nuevo, con la trampa del 55P04 de por medio.
- **El `orden` existe porque el alfabético pone «10» antes que «9»**, y eso manda a la mucama a
  caminar el pasillo en zigzag.
- **No se inventó el piso en la migración.** Queda vacío y la pantalla dice «sin asignar». Poner
  «1» en todas sería un dato falso que nadie corregiría porque parecería cargado.
- **Los valores de los filtros salen de los datos**, no de una lista fija: el hotel nombra sus
  sectores como quiera. Si no hay ninguno cargado, el filtro no aparece.
- **Las acciones rápidas son enlaces, no botones de acción directa.** Un clic accidental en una
  grilla densa no puede cambiar el estado de una habitación sin confirmación.

**No implementado, con motivo:** «cerrar noche» y «optimizar asignación» del checklist. El primero
es un proceso de cierre contable que necesita una definición del hotel (qué se congela, qué pasa
con las cuentas abiertas); el segundo es un problema de asignación que exige decidir qué se
optimiza —ocupación, rotación, ingresos— y esa decisión no está tomada. Se dejan afuera antes que
adivinarlas.

## Paso 11 — Respaldos ✅

**Terminado el 2026-08-16.** 22 tests nuevos.

### La parte incómoda, dicha de frente

El pedido era «backups (o al menos un botón que dispare/verifique el backup automático de la
base)». **La aplicación no puede hacer eso.** Los backups de Postgres los hace la plataforma
(Supabase: copias diarias y, según el plan, PITR) y no hay API para dispararlos desde la app.

Un botón que dijera «Hacer backup» sin hacerlo sería la peor función del sistema: alguien lo
apretaría, vería «listo», y se enteraría de la verdad el día que necesite restaurar. Así que la
pantalla hace tres cosas que sí son ciertas:

1. **Explica quién es responsable de qué**, con nombre.
2. **Exporta los datos operativos** a un JSON que el hotel se baja y guarda. No reemplaza al backup
   de la base —no incluye usuarios de auth, políticas ni funciones— pero responde la pregunta que
   importa («si esto se cae, ¿tengo mis reservas?») y **se puede abrir y verificar**, que es más de
   lo que se puede decir del backup de la plataforma.
3. **Registra cuándo fue la última vez**, para que la respuesta no dependa de que alguien se acuerde.

- [x] Migración `0043_registro_de_respaldos.sql` — tabla `respaldos`, sin `update` ni `delete`
- [x] `lib/domain/respaldos.ts` — las 22 tablas con el motivo de cada una, frescura, nombre de archivo
- [x] `tests/respaldos.test.ts` — 22 tests, incluido el orden de dependencia de las tablas
- [x] `app/api/respaldo/route.ts` — export completo, **solo admin**, con `traerTodo`
- [x] `app/panel/respaldos` — estado, explicación, qué incluye y historial
- [x] Área `respaldos`: admin exporta, **gerencia sólo mira** el estado

**Decisiones:**

- **Solo admin exporta.** El archivo concentra nombre, email y teléfono de todos los huéspedes que
  pasaron por el hotel: es la mayor concentración de datos personales que el sistema puede producir.
  Gerencia ve el estado —saber que hace 40 días que nadie exporta es información de gestión— pero
  no baja el archivo.
- **`traerTodo` y no un `select` pelado.** PostgREST corta en 1000 filas sin error y sin aviso. Un
  respaldo truncado en silencio es peor que ninguno: parece completo.
- **La aclaración de alcance va DENTRO del archivo**, no sólo en la pantalla: si alguien lo
  encuentra en un disco en tres años tiene que saber qué no contiene.
- **No se exporta todo.** Queda afuera lo regenerable (`intentos_limitados`) y `auditoria`, que
  crece sin techo y no sirve para reconstruir la operación. Exportar de más hace el archivo más
  grande y más peligroso, no más útil.
- **Sin `update` ni `delete` en el registro.** Si se pudiera borrar, la respuesta a «cuándo fue el
  último» dejaría de ser confiable — que es lo único que esa tabla existe para garantizar.
- **«Nunca» se distingue de «viejo».** Son dos situaciones distintas: nadie lo configuró todavía,
  contra alguien lo hacía y dejó de hacerlo.

## Detalle original del paso 9 — Housekeeping móvil

Existe el tablero de admin: unidades, estados HK, KPIs, asignación por mucama
(`unidades.asignada_a`), agrupación por responsable, y RLS que deja a `housekeeping` actualizar.

Faltan: llegadas/salidas/en reparación en el mismo panel, contadores por mucama
(asignadas/limpiadas/faltantes/inspeccionadas), y el **flujo pensado para el celular de la
mucama** — hoy es un tablero de administración.

## Paso 10 — Piso/bloque + acciones rápidas (**mostrar diff**)

`unidades` tiene `tipo_unidad_id`, `nombre`, `estado`, `activo`, `asignada_a`. **No hay piso ni
bloque.** Faltan también las acciones rápidas desde la celda de la grilla: mantenimiento, mucama,
marcar sucia/limpia, cerrar noche.

## Paso 11 — Backups

No existe nada (`grep backup|respaldo` → cero). Falta el botón que dispare/verifique el backup y
muestre cuándo fue el último. Solo admin.

---

## Deuda descubierta en el camino

Cosas que no son parte de los 11 pasos pero aparecieron al recorrer el repo. **No arreglar de
paso** — anotar acá y decidir después.

| Qué | Dónde | Por qué importa |
|---|---|---|
| `pagos.nota` y `reservas.notas` son texto libre | esquema | Es donde recepción va a pegar un número de tarjeta por costumbre de WinPAX |
| `toLocaleString('es-AR')` repetido en ~30 lugares del panel | `app/panel/**` | Publica 3 formatos distintos en una misma columna; `lib/domain/moneda.ts` ya lo resuelve para el portal |
| 19 lugares con el literal `['admin','gerencia']` | varios | Debería ser `lib/domain/permisos.ts` (ya anotado en `AGENTS.md`) |
| Atomicidad en los flujos de varios pasos de `reservas` | `app/panel/reservas/actions.ts` | Si falla el paso 3 los datos quedan a medias; pide una función SQL transaccional |
