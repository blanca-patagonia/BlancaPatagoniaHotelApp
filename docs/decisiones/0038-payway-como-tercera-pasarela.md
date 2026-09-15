# ADR 0038 — Payway como tercera pasarela (posnet / tarjeta local)

- **Estado:** Aceptada
- **Fecha:** 2026-09-14
- **Origen:** pedido del dueño del hotel de sumar Payway (posnet) además de
  Mercado Pago, con integración real (no un simulador más).

## Contexto

El ADR 0027 ya dejó dos pasarelas reales escritas — Mercado Pago Checkout Pro
y Stripe Checkout Sessions— con un patrón común: `crearCheckout` devuelve una
URL de un **checkout alojado por el proveedor**, el huésped paga ahí, y el
proveedor avisa el resultado por webhook. Payway (la marca de Prisma /
antes Decidir) **no tiene ese modo**. Su API pública (`developers.payway.com.ar`,
Gateway API) resuelve el pago en dos pasos siempre del lado del integrador:

1. **Tokenización** — el navegador del huésped manda los datos de la tarjeta
   (PAN, vencimiento, CVV, titular) directo a Payway con la **llave pública**,
   y recibe un `token` de un solo uso. La tarjeta nunca toca nuestro servidor.
2. **Ejecución del pago** — el servidor manda ese `token` más
   `site_transaction_id`, `amount` (en **centavos**, mismo formato que
   Stripe — ver ADR 0027 sobre ese mismo error posible) y `installments` a
   Payway con la **llave privada**, y la respuesta (`approved`/`rejected`) es
   **síncrona**: no hace falta webhook para saber el resultado de una
   tarjeta.

Esto no encaja en `crearCheckout` devolviendo una URL externa: haría falta
alojar NOSOTROS el formulario con el script de tokenización de Payway.

## Decisión

**Checkout propio, no redirect externo.** `ProveedorPayway.crearCheckout`
devuelve la URL de una pantalla del propio sistema
(`/pago-payway/[reservaId]`), no la de Payway. Esa pantalla:

1. Carga el script de tokenización de Payway con la **llave pública**
   (`PAYWAY_PUBLIC_KEY`, la única credencial que puede viajar al navegador).
2. El huésped carga los datos de la tarjeta ahí, Payway devuelve el `token`.
3. Un `<form>` manda ese `token` (nunca el PAN) a una Server Action /
   route handler propio, que llama a la API de Payway con la **llave
   privada** (`PAYWAY_PRIVATE_KEY`, solo servidor) para ejecutar el pago.
4. La respuesta síncrona (`approved`/`rejected`) confirma o rechaza ahí
   mismo — sin webhook.

**`verificarFirma`/`parsearWebhook` SÍ hacen algo real, pero de un evento que
genera el propio sistema, no Payway.** Payway no manda un webhook asincrónico
para pagos con tarjeta (la respuesta ya es síncrona en el paso 3), así que en
vez de inventar un caso especial que saltee el pipeline de `pagos` — la única
fuente de verdad de cuándo una reserva queda saldada — el route handler del
paso 3 arma el mismo evento que mandaría una pasarela real y lo postea,
firmado con HMAC, contra `/api/webhooks/pagos/payway`. Es EXACTAMENTE el
patrón que ya usa `app/pago-simulado/actions.ts` (`resolverPagoSimulado`)
para ejercitar el circuito completo sin pasarela real: nunca escribe en
`pagos` a mano, siempre pasa por firma → parseo → transición de estado →
saldado. La firma usa un secreto propio (`PAYWAY_INTERNAL_SECRET`), no el de
ninguna pasarela real — lo que certifica acá no es "esto lo mandó Payway",
sino "esto lo generó nuestro propio servidor después de una respuesta
`approved` de Payway", y ese es exactamente el evento que hay que confiar.

**`medio_pago` (enum de `pagos`, migración 0009) suma `'payway'`** —
migración 0104, solo el `alter type ... add value`, sin usarlo en la misma
migración (regla del proyecto contra SQLSTATE 55P04).

**No se escribió contra un sandbox real.** Igual que Mercado Pago y Stripe
en su momento (ADR 0027): el código sigue el contrato documentado
públicamente por Payway, pero no hay cuenta de test para ejercitarlo de
punta a punta. Activarlo es cargar `PAYWAY_PUBLIC_KEY` +
`PAYWAY_PRIVATE_KEY` y sumar `payway` a `PAGO_PROVIDER`, no tocar código —
mismo régimen que las otras dos.

## Sobre "Santander" como pasarela

El pedido original mencionaba "posnet Payway, Mercado Pago y Santander".
Santander Argentina **no expone una API de cobro para comercios** — a
diferencia de Payway o Mercado Pago, un banco no es un procesador de
pagos. Lo que ya existe en el sistema con ese nombre es
`ExtractoProvider` (`lib/conciliacion/`, ADR 0030): la conciliación
contra el extracto bancario de Santander, por archivo, porque el banco
tampoco tiene banca abierta. Esto no cambia con este ADR. Si el hotel
tiene un posnet físico de Santander/Getnet en el mostrador, se sigue
registrando como hoy: un pago en efectivo/tarjeta cargado a mano en el
punto de venta, no una integración — inventar una API que no existe
sería peor que no tener nada.

## Consecuencias

- Tercera pasarela con integración real, pero con una forma de UI distinta
  a las otras dos (checkout propio en vez de redirect externo) — cualquiera
  que toque `app/pago-mercadopago`/`app/pago-stripe` como referencia para
  «cómo se ve un checkout» va a encontrar un patrón distinto en
  `app/pago-payway`.
- Nueva superficie pública: `/pago-payway/[reservaId]` y su Server Action
  de ejecución de pago quedan expuestas sin autenticación de staff (como ya
  pasa con el resto del checkout de reservas), así que llevan el mismo
  límite de tasa que el resto del borde público (`lib/domain/limites.ts`).
