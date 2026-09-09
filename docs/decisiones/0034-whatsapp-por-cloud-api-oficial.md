# ADR 0034 — WhatsApp por la Cloud API oficial, y solo un evento por ahora

- **Estado:** Aceptada
- **Fecha:** 2026-09-09
- **Origen:** Fase 3 de un pedido de incorporar patrones de sistemas de
  referencia (channel manager, PMS, mensajería, facturación). Patrón de
  referencia de esta fase: Evolution API.

## Contexto

El hotel solo avisaba al huésped por email. Un huésped que reserva desde el
teléfono mira WhatsApp antes que su casilla, y el pedido explícito era sumar
ese canal para confirmación de reserva, recordatorio y bienvenida, con
arquitectura basada en eventos (webhooks), no en sondear al proveedor.

`notificaciones` (migración 0075) ya tenía la columna `canal` con `whatsapp`
como valor válido desde el primer día — "previsto para no migrar al
enchufarlo", decía el comentario. Nadie lo usaba: `encolar` escribía
`canal: 'email'` a mano y `despachar` solo sabía llamar al proveedor de
correo. El "previsto" era aspiracional, no funcional.

## Decisión

### 1. Cloud API oficial de Meta, no un puente sobre WhatsApp Web

Un puente no oficial (Baileys y similares) usa el número como si fuera una
persona operando WhatsApp Web. Meta lo detecta y banea el número — y sería
el número real del hotel, el mismo publicado en su web y en Booking. La
Cloud API es la única vía que no arriesga ese número.

### 2. Mismo patrón simulador/real que los demás adapters

`lib/whatsapp/index.ts` (interfaz + simulado) y `lib/whatsapp/meta.ts`
(real, por HTTP y sin SDK — mismo criterio que MercadoPago, Stripe y Resend).
`WHATSAPP_PROVIDER` sigue el mismo mecanismo de `seleccionarProveedor` que ya
usan los otros seis.

### 3. El canal entra al esquema existente, con dos ajustes

- **`claveDeNotificacion` distingue el canal**, pero solo cuando NO es
  `email`. Un mismo evento (`confirmacion_reserva`) puede mandarse por los
  dos canales a la vez — el segundo insert no puede chocar contra el
  primero por tener la misma clave. Las filas ya encoladas antes de esta
  fase no cambian de clave.
- **Las plantillas de WhatsApp NO son las de email.** Meta exige plantillas
  aprobadas de antemano, con parámetros posicionales; no se puede mandar el
  texto libre que ya arma `lib/domain/plantillas.ts` para el correo. Por
  eso `PLANTILLAS_WHATSAPP` es un catálogo aparte, con la lista de qué
  variable va en qué posición — y **solo `confirmacion_reserva` tiene
  entrada** (ver "Lo que queda afuera").

### 4. Estado de entrega real, por webhook (migración 0090)

`notificaciones.estado` solo sabía lo que el propio sistema hizo
(`enviada` = "se lo entregamos a Meta"). Se suman `entregada` y `leida`,
que son los únicos que puede informar el proveedor, más `id_externo` para
correlacionar el evento del webhook con la fila. `esAvanceDeEntrega`
(`lib/domain/notificaciones.ts`) evita que un evento que llega
desordenado —Meta no garantiza el orden— haga retroceder de `leida` a
`entregada`.

## Lo que queda afuera, a propósito

1. **Solo `confirmacion_reserva` tiene plantilla de WhatsApp.** El pedido
   mencionaba también recordatorio pre-checkin y bienvenida. Sumarlos exige
   que esas plantillas existan y estén APROBADAS en Meta Business Manager
   con la cuenta real del hotel — no es algo que el código pueda resolver
   solo. `armarMensajeWhatsApp` devuelve `null` para cualquier evento sin
   entrada en el catálogo, así que agregar uno nuevo es una línea, no un
   cambio de arquitectura.
2. **Los mensajes ENTRANTES del huésped solo se registran en el log**, no se
   enrutan a `conversaciones` ni generan respuesta automática. Tender ese
   puente de dos vías es una integración de otro tamaño — decidir si
   conviene una instancia de WhatsApp compartida con otro proyecto del
   usuario, o una propia, es anterior a escribir ese código.
3. **Nada de esto se probó contra la Cloud API real.** No hay número de
   WhatsApp Business del hotel verificado ni plantillas aprobadas todavía.
