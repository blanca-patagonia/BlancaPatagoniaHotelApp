# Conectar las integraciones y la bandeja de mensajes

> Guía práctica para quien enchufa el sistema. El porqué de cada decisión está en
> los **ADR 0043 y 0044**. La lista de variables sale de un solo lugar
> (`src/lib/domain/integraciones.ts`) y se ve completa en **Configuración →
> Integraciones y claves**.

## 1. El camino corto

```
npm run configurar            # elegís el servicio, pegás las claves, se prueban solas
npm run integraciones         # ¿qué está conectado y qué responde?
```

`npm run configurar` pregunta una clave por vez (no se ve mientras la escribís),
**genera sola** las que inventa el hotel, **prueba cada clave contra el
proveedor antes de guardarla**, la guarda en `.env.local` y ofrece conectar el
canal. Sirve para Mercado Pago, Stripe, Payway, Resend, WhatsApp, Instagram,
Messenger, Telegram y la IA.

> ⚠️ **No pegues claves en un chat, un correo ni un ticket.** Quedan guardadas
> donde no deberían. Se escriben en la terminal con ese comando, o directo en
> `.env.local` / Vercel. Desde Claude Code: `! npm run configurar`.

Y en el panel, **Bandeja → Canales** tiene un asistente por canal con el mismo
recorrido, con estado en vivo de cada paso:

1. **Conseguí estos datos** — cada variable aparece tildada cuando ya está cargada.
2. **Cargalos** — un bloque para copiar con lo que falta.
3. **Conectar** — un botón que le dice al proveedor a dónde mandar los mensajes.
   Después, **«Verificar que funciona»** pregunta al proveedor si quedó bien.
4. **Ajustes** — saludo, horario de atención, asignación automática.

## 2. Hace falta una dirección pública

Meta, Resend, Telegram, Mercado Pago y Stripe **avisan** al sistema llamando a una
URL. Con el sistema en `localhost` esa llamada no llega nunca, y «Conectar» te lo
dice antes de intentar. Dos opciones:

- **Producción:** `NEXT_PUBLIC_SITE_URL` es la dirección publicada (https).
- **Para probar en local:** un túnel (`npx cloudflared tunnel --url
  http://localhost:3000` o `ngrok http 3000`), y poner esa dirección https en
  `NEXT_PUBLIC_SITE_URL` mientras se prueba.

## 3. Cada canal

### WhatsApp, Instagram y Messenger (una sola app de Meta)

Lo que **no** se puede hacer desde el sistema, y es lo que más tarda:

- Una cuenta de **Meta Business** con el hotel **verificado** (lo hace Meta;
  puede tardar días).
- Un **número** para WhatsApp Business que no esté en la app común de WhatsApp.
- Una **app de Meta** (tipo «Empresa») con los productos WhatsApp, Instagram y/o
  Messenger agregados.

Los datos que hay que copiar de Meta:

| Variable | Dónde está |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | Configuración de la app → Básica |
| `WHATSAPP_TOKEN` | Business Manager → Usuarios del sistema → generar token **permanente** con `whatsapp_business_messaging` y `whatsapp_business_management`. El temporal dura 24 h |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp → Configuración de la API |
| `INSTAGRAM_ACCESS_TOKEN` | Producto Instagram → API con inicio de sesión de Instagram (cuenta profesional). Vence a los 60 días |
| `MESSENGER_PAGE_TOKEN` | Producto Messenger → token de la **página** (no el del usuario) |
| `META_WEBHOOK_VERIFY_TOKEN` | Lo inventa el hotel: el asistente lo genera con un botón |

Con eso cargado, **«Conectar»** hace del lado de Meta lo que antes se hacía a
mano en su panel: suscribe la app a la cuenta y le dice a dónde avisar. Si
prefieren hacerlo a mano, la URL es `…/api/webhooks/meta` (la misma para los
tres), con el token de verificación y los campos `messages` (más
`message_deliveries` y `message_reads` en Messenger).

**Modo «En vivo».** Mientras la app esté en modo desarrollo, sólo recibe mensajes
de personas con rol en la app. Para recibir los de cualquier huésped hay que pasar
la **revisión de la app** de Meta (permisos de mensajería) y ponerla «En vivo».

**Limitación que no se arregla con código:** pasadas 24 horas desde el último
mensaje del huésped, WhatsApp sólo acepta plantillas aprobadas, e Instagram y
Messenger nada. Con el permiso «Human Agent» aprobado por Meta, estos dos últimos
dejan responder hasta 7 días (`META_HUMAN_AGENT=1`).

> **Sin verificar contra Meta real:** el registro automático del webhook a nivel
> de la app (Instagram y Messenger) está escrito según la documentación, pero no
> se pudo probar sin credenciales. Si falla, el asistente muestra el mensaje de
> Meta tal cual; pegar la URL a mano da el mismo resultado.

### Correo

Para **enviar**: una cuenta de Resend con el dominio del hotel verificado
(`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_PROVIDER=resend`).

Para **recibir** los correos de los huéspedes en la bandeja:

> ⚠️ **Usá un SUBDOMINIO, nunca el dominio principal.** El registro MX de Resend
> **reemplaza** al del dominio: ponerlo en `blancapatagonia.com` deja al hotel sin
> su correo de siempre. Con un subdominio (por ejemplo `bandeja.blancapatagonia.com`)
> el correo normal no se toca.

1. En Resend → Receiving: habilitar la recepción en el subdominio (registro MX *del
   subdominio*).
2. En el correo del hotel (Gmail, etc.): reenviar lo que llegue a
   `hola@bandeja.blancapatagonia.com`, o dar esa dirección en las consultas.
3. En el asistente del canal Correo: **«Crear el webhook en Resend»**. Lo crea con
   los eventos que hacen falta y muestra el secreto **una sola vez**: copialo en
   `RESEND_WEBHOOK_SECRET`. (`npm run configurar` lo hace y lo guarda solo.)
4. `RESEND_API_KEY` tiene que tener acceso completo; con una de «sólo envío» no se
   puede leer el contenido de lo recibido, y la verificación lo avisa.

### Telegram

1. En Telegram, hablarle a **@BotFather** → `/newbot` → `TELEGRAM_BOT_TOKEN`.
2. `TELEGRAM_WEBHOOK_SECRET`: el asistente lo genera.
3. Con el sistema publicado, **«Conectar el bot»**.

### Chat de la web

No necesita claves: ya funciona. En el asistente del portal aparece «Hablar con
recepción».

## 4. Saludo, fuera de horario y asignación

En el último paso de cada canal:

- **Saludo automático:** se manda una vez a quien escribe por primera vez. Admite
  `{{nombre}}` (el primer nombre; si no se conoce, se omite sin dejar un hueco).
- **Fuera de horario:** una vez por conversación nueva, y reemplaza al saludo
  (nunca salen los dos). El horario es **la hora de El Calafate**.
- **Ninguno cuenta como respuesta de una persona:** la conversación sigue
  figurando como «esperando» hasta que alguien contesta.
- **Asignación automática:** cada conversación nueva va a quien de recepción tenga
  menos abiertas. El sistema no sabe quién está de turno: conviene sólo si el turno
  es siempre de las mismas personas.

## 5. Cobros, IA y el resto

Mercado Pago, Stripe, Payway, el asistente de IA y la cotización tienen su ficha
completa en **Configuración → Integraciones y claves**, con los pasos, la URL del
webhook y un botón para probar. Las variables obligatorias en producción y qué
pasa si falta cada una están en `despliegue.md` §1.

**Booking y Expedia no se conectan con una clave:** sólo dan API a Connectivity
Partners. Lo que se puede hacer sin eso es leer por iCal (no evita el
overbooking) o contratar un channel manager (ADR 0021 y 0035).

## 6. Si algo no anda

| Síntoma | Qué mirar |
|---|---|
| «Conectar» dice que la dirección no sirve | `NEXT_PUBLIC_SITE_URL` es `localhost` o no es https |
| Meta dice que no pudo verificar la URL | El sistema tiene que estar levantado y público, y `META_WEBHOOK_VERIFY_TOKEN` cargado **antes** de apretar «Conectar» |
| Las claves están y no llegan mensajes | «Verificar que funciona»: muestra cuál de los tres pasos de Meta falta |
| Llegan mensajes y no se puede responder | Falta la clave de **envío** del canal, o pasaron 24 horas desde su último mensaje |
| Instagram dejó de responder | El token de Instagram vence a los 60 días: generar uno nuevo |
| El correo entrante no aparece | `RESEND_WEBHOOK_SECRET` sin cargar, o la recepción no está habilitada en el subdominio |
| Un error de «sin respuesta» en `/panel/errores` | Cada fallo del webhook queda registrado ahí (`webhook_meta_*`, `bandeja_entrada_fallo`) |
