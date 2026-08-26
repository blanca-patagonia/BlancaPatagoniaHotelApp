# ADR 0027 — Cobro en línea: dos pasarelas y una sola moneda de saldo

- **Estado:** Aceptada
- **Fecha:** 2026-08-25
- **Complementa:** [ADR 0003](0003-moneda.md) · [ADR 0006](0006-pagos-abstraccion-e-idempotencia.md) · [ADR 0018](0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md) · [ADR 0020](0020-cotizacion-de-divisas.md) · [ADR 0025](0025-verificar-la-tarjeta-sin-guardar-el-numero.md)
- **Origen:** pedido del usuario del 25/08/2026 — «que funcione a la perfección la pasarela de pagos, el pago de tarjeta para la gestión y las reservas», con la aclaración de que **el hotel es internacional** y tiene que poder cobrar con cualquier tarjeta de crédito o débito, MercadoPago, billeteras virtuales y efectivo.

## Contexto

El puerto de pagos existía desde la Fase 3 y estaba **desenchufado**. El
diagnóstico, verificado sobre el código:

| Qué | Estado real antes de este ADR |
|---|---|
| `crearCheckout()` | **Cero call sites.** Nadie cobraba en línea, ni la web ni el mostrador |
| `/pago-simulado` | La URL que devolvía el stub **daba 404**: la pantalla no existía |
| Portal público | Creaba la reserva `pendiente` y decía «te escribimos para coordinar cómo abonar» |
| Panel | `medio = 'tarjeta'` era una etiqueta sin cupón, sin lote y sin últimos 4 |
| `PAGO_PROVIDER` | **No existía.** Pagos era el único de los siete adaptadores fuera del ADR 0018 |
| `MERCADOPAGO_ACCESS_TOKEN` | Declarado en `.env.example`, **ningún archivo lo leía** |

El webhook, en cambio, estaba bien hecho: idempotente por `external_id`, con
firma HMAC real y fallando cerrado. Lo que faltaba era **todo lo que va antes**.

## Decisión

### 1. Dos pasarelas a la vez, no una

Es la consecuencia directa de que el hotel sea internacional. Ninguna pasarela
cubre bien los dos públicos:

| | Stripe | MercadoPago |
|---|---|---|
| Público | Huésped del exterior | Huésped argentino |
| Moneda | **USD**, sin conversión | **ARS** |
| Medios | Visa, Mastercard, Amex, Apple Pay, Google Pay | Crédito con cuotas, débito, dinero en cuenta, **efectivo en Rapipago y Pago Fácil** |

El efectivo es el que decide: ninguna pasarela internacional lo ofrece, y es el
medio del huésped argentino sin tarjeta. Y el USD directo es el que decide del
otro lado: si a un huésped alemán se le cobrara en pesos, la conversión la haría
su banco a un tipo de cambio que el hotel no controla ni puede explicar.

**Consecuencia sobre el ADR 0018.** Los otros seis adaptadores eligen *un*
proveedor con `seleccionarProveedor`. Acá la pregunta del negocio es distinta:
el hotel no elige con qué pasarela trabaja, elige **qué medios le ofrece al
huésped**, y son varios a la vez. Por eso `PAGO_PROVIDER` admite una lista
separada por comas y existe `seleccionarProveedores` (plural). Todas las
garantías del singular se conservan: fuera de producción cae al simulador sin
ruido, y en producción un nombre desconocido **lanza** en vez de achicar la
lista en silencio —que dejaría al hotel sin un medio de pago sin que nadie vea
un error—.

### 2. `pagos.monto` está SIEMPRE en USD. Es la invariante que sostiene todo.

Es la decisión más importante del ADR, y la que evita el peor bug posible.

`resumenPagos` suma `pagos.monto` para decidir si la reserva quedó saldada, y
**no mira la moneda**. Con MercadoPago cobrando en pesos, un pago de ARS 350.000
guardado en esa columna se sumaba como si fueran USD 350.000: la reserva se daba
por pagada al instante y **el huésped se iba sin pagar**.

La regla, con los `check` de la migración 0067 que la sostienen en la base:

```
monto         → SIEMPRE USD. Es lo único que salda la reserva.
moneda        → la que de verdad pasó por la pasarela o por la caja.
monto_cobrado → cuánto se cobró en esa moneda.
cotizacion    → a qué tipo de cambio se convirtió.
```

**La cotización se congela al crear el link**, no al confirmar el pago. Si se
recalculara después, el saldo de una reserva se movería con el dólar del día
siguiente y no habría forma de explicar de dónde salió el importe en dólares que
la saldó.

Y `pagos_conversion_coherente` lo impone en la base: un pago en moneda
extranjera **sin cotización no entra**.

### 3. El importe que salda es el que se pidió, no el que informa la pasarela

Cuando el sistema originó el cobro, ya dejó escrito en la fila `pendiente`
cuánto se pidió cobrar. El evento del webhook solo **confirma**.

Si el importe informado no coincide con el pedido —al centavo— el pago **no
salda nada**: queda marcado `rechazado` con una nota para revisar a mano. Es la
defensa contra un link manipulado, un evento cruzado de otra reserva o una
integración mal configurada. Saldar ante una diferencia es lo caro.

### 4. Un solo link vivo por saldo

Dos links por la misma seña son dos cobros posibles: el huésped abre el que le
llegó por correo, no lo encuentra, pide otro y termina pagando los dos.
Devolver esa plata es un trámite manual con la pasarela más una discusión.

`iniciarCobro` **reutiliza** el link vigente en vez de crear otro, y sólo crea
uno nuevo si el saldo cambió (se cargaron consumos) o si el anterior venció. Los
links viven **48 horas**: cómodo para quien lo abre al día siguiente, y bien
adentro de los 5 días que una reserva pendiente bloquea la unidad.

### 5. El simulador cierra el circuito, y dice que es un simulador

`/pago-simulado` existe para que el cobro se pueda **recorrer y demostrar
entero** sin contratar una pasarela: se genera el link, se elige el desenlace
(aprobar, rechazar, dejar pendiente), se dispara el webhook **firmado con el
mismo HMAC** y la reserva se salda sola.

Dos cosas lo hacen honesto y no un atajo:

- **Dice lo que es, en grande.** El aviso «acá no se mueve dinero» es lo primero
  que se lee, y los botones se llaman «aprobar» y «rechazar», que es vocabulario
  de simulador y no de pasarela.
- **Ejercita el camino real.** No escribe en `pagos` por su cuenta: llama al
  endpoint del webhook. Si escribiera directo estaría probando un camino que en
  producción no existe, y el día que se enchufe MercadoPago aparecerían bugs en
  código que nunca se ejercitó.

Sólo existe si alguien lo habilitó a propósito en `PAGO_PROVIDER`; si no,
responde 404.

### 6. Ninguna pasarela verifica la tarjeta de garantía, y las tres lo declaran

Cobrar y preautorizar son cosas distintas. Checkout Pro y Checkout Sessions
cobran; guardar un token reutilizable para la garantía pide Checkout API con
tokenización o SetupIntents, que son otros flujos con otra exigencia de
certificación PCI.

Las tres implementaciones devuelven `capacidades().verificaTarjeta === false` y
`{ ok: false, noSoportado: true }`. Es el ADR 0025 sin cambios: un `ok: false`
por rechazo del emisor significa «pedile otra tarjeta»; uno por falta de
pasarela significa «no sabemos nada de esta tarjeta».

## Lo que se descubrió al conectarlo

Dos bugs que **sólo existen cuando el cobro funciona de verdad**, y que el
puerto desenchufado escondía:

### La seña no confirmaba la reserva

`pendiente → pagada` **no es una transición válida** de la máquina de estados:
hay que pasar por `confirmada`. Una reserva de la web nace `pendiente`, así que
el pago se registraba, la transición se descartaba en silencio por inválida y la
reserva quedaba `pendiente`. **La expiración la liberaba a los 5 días y el hotel
revendía la unidad con la plata del huésped ya cobrada.**

Se resolvió con dos funciones de dominio: `estadoSegunPagos` —la regla del
Tarifario, «la reserva se bloquea con el pago de la seña»— y `caminoDeEstados`,
que recorre `pendiente → confirmada → pagada` en vez de intentar el salto.

### Un pago rechazado trababa el reintento

`puedeAvanzarEstadoPago` trataba `rechazado` como estado final. Pero una pasarela
real crea **varios intentos bajo la misma referencia externa**: la tarjeta se
rechaza por fondos, el huésped pone otra y el segundo intento aprueba. Los dos
eventos llegan con el mismo `external_id`, y el rechazo trababa la fila: la
reserva no se saldaba nunca **con la plata ya cobrada**.

Hoy `rechazado → aprobado` está permitido y `aprobado`/`reembolsado` siguen
siendo terminales, así que un rechazo atrasado no degrada un cobro confirmado.

## Alternativas descartadas

- **Una sola pasarela.** Dejaba afuera a la mitad de los huéspedes: o el
  argentino sin tarjeta, o el extranjero pagando una conversión que el hotel no
  controla.
- **Guardar el importe en la moneda de cobro y convertir al leer.** Es lo que
  provoca el bug de la sección 2. Además haría que el saldo histórico de una
  reserva cambiara con el dólar de hoy.
- **Usar los SDK oficiales.** Son tres llamadas HTTP y un HMAC. El SDK arrastra
  dependencias y un ciclo de vida propio; se prefirió `fetch` y una dependencia
  menos que auditar.
- **Confiar en la URL de retorno de la pasarela para mostrar «pagado».** Esa URL
  se puede abrir a mano sin haber pagado nada. La pantalla de confirmación lee el
  estado **de la base**, que es lo que escribió el webhook.
- **Limitar el webhook por volumen.** Cada evento descartado es un cobro del que
  el hotel no se entera. El límite se cuenta **sólo después de rechazar la
  firma**, así que un evento legítimo nunca pasa por ahí.

## Consecuencias

- Se puede cobrar desde la web y desde el mostrador, en dólares y en pesos, con
  tarjeta internacional, tarjeta local, cuotas, billetera o efectivo.
- El mostrador registra la moneda real del cobro y el cupón del posnet, así que
  la caja cierra contra el sistema.
- **Enchufar una pasarela real es cargar variables de entorno**, no tocar código.
- El hotel sigue sin poder verificar una tarjeta de garantía. Está declarado.
- Si `PAGO_PROVIDER` falta en producción, el sistema **no arranca**. Es a
  propósito (ADR 0018).

### Variables de entorno

| Variable | Cuándo | Qué |
|---|---|---|
| `PAGO_PROVIDER` | **Obligatoria en producción** | Lista separada por comas: `mercadopago,stripe`. O `simulado` para declarar explícitamente que no se cobra de verdad |
| `MERCADOPAGO_ACCESS_TOKEN` | Si se usa MercadoPago | Access token de la aplicación |
| `MERCADOPAGO_WEBHOOK_SECRET` | Si se usa MercadoPago | Clave secreta de la notificación, del panel de MercadoPago |
| `STRIPE_SECRET_KEY` | Si se usa Stripe | `sk_live_…` / `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | Si se usa Stripe | `whsec_…` del endpoint |
| `PAGO_WEBHOOK_SECRET` | Sólo con el simulador | Firma del webhook simulado. Sin ella se acepta fuera de producción y se rechaza en producción |
| `NEXT_PUBLIC_SITE_URL` | **Obligatoria en producción** | Ya existía. Ahora también arma la `notification_url` que se le manda a MercadoPago |

Las URLs de webhook a registrar en cada panel:

```
https://<dominio>/api/webhooks/pagos/mercadopago
https://<dominio>/api/webhooks/pagos/stripe
```
