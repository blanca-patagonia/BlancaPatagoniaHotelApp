# ADR 0043 — Bandeja de mensajes con huéspedes (estilo Chatwoot) y las claves en un solo lugar

- **Estado:** aceptada
- **Fecha:** 2026-10-21
- **Continúa en:** ADR 0044 (conexión guiada de canales, contactos, informes y mensajes automáticos)
- **Relacionadas:** ADR 0011 (chat interno + asistente por reglas), 0018 (simuladores que fallan fuerte), 0021/0035 (canales de venta y channel manager), 0029 (registro de errores), 0036 (cifrado de credenciales de terceros)

## Contexto

Hasta acá **no entraba ningún mensaje de un huésped**. WhatsApp sólo salía, por
plantilla (`lib/whatsapp`). Los mensajes de Booking se cargaban a mano
(`canal_mensajes`). El asistente del portal anotaba en `consultas_bot` lo que no
supo responder, sin forma de contestarle a nadie. Y `panel/conversaciones` es
el chat **interno** del staff (ADR 0011), que el hotel pidió ocultar «hasta que
llegue la bandeja única estilo Chatwoot».

El pedido del usuario tenía dos partes:
1. Una bandeja omnicanal y un CRM basados en Chatwoot, tomados de su código.
2. Que conectar cada servicio (Mercado Pago, correo, WhatsApp, Instagram…) se
   reduzca a cargar las claves.

## Decisión

### 1. Se porta el modelo de Chatwoot; no se ejecuta Chatwoot

Chatwoot está hecho en Rails + Vue, y este sistema en Next + Supabase: su
código no se puede pegar. Hay dos caminos:

- **Correr Chatwoot aparte** e integrarlo por API. Así tendría todos sus
  canales al instante, pero sería otro servidor que mantener, con otra base y
  otro login. Además los mensajes de un huésped quedarían lejos de su ficha y
  de sus reservas.
- **Portar su diseño al PMS.** Se eligió este, y el usuario lo validó.

De Chatwoot se toma, del núcleo MIT y **nada de `enterprise/`** (aviso en
`docs/licencias/chatwoot-MIT.txt`):

| Chatwoot | Acá |
|---|---|
| `inboxes` + `channel_*` | `crm_bandejas` (una por canal) |
| `contacts` + `contact_inboxes` | `crm_contactos` + `crm_identidades` |
| `conversations` (open/pending/snoozed/resolved, prioridad, `waiting_since`) | `crm_conversaciones` |
| `messages` (incoming/outgoing/activity, `private`, estados de entrega) | `crm_mensajes` (`entrante`/`saliente`/`actividad`/`nota`) |
| `labels`, `canned_responses` | `crm_etiquetas`, `crm_respuestas` |
| `Whatsapp::IncomingMessageBaseService`, `InstagramEventsJob`, `Telegram::…` | `lib/domain/bandeja-entrante.ts` |
| `SendOnInstagramService`, `HumanAgentTagHelpers`, `MetaTokenVerifyConcern` | `lib/bandeja/canales.ts`, `lib/integraciones/firma-meta.ts` |
| web widget + `pubsub_token` | chat con recepción del portal, token en cookie httpOnly |

Lo que se deja afuera a propósito: cuentas (es un solo hotel, igual que la 0096),
equipos, SLA, campañas y bots.

Lo que se agrega y Chatwoot no tiene: el contacto se **vincula a la ficha del
huésped** (por email o los últimos 10 dígitos del teléfono, sólo si coincide
uno), y la columna derecha muestra sus reservas.

### 2. La integridad de la bandeja vive en la base

- **`crm_registrar_entrante`** (0125, reescrita en 0126): identidad, contacto,
  conversación y mensaje se guardan en **una** transacción. Un candado de
  asesoría por `(bandeja, contacto externo)` evita que dos webhooks del mismo
  huésped abran dos conversaciones. Y la clave única `crm_mensajes.externo_id`
  hace que el reintento de Meta sea un no-op. Es `security definer` y la
  ejecuta sólo `service_role`.
- **Un trigger** mantiene la conversación al día (no leídos, «espera desde»,
  primera respuesta, reapertura). Hay tres caminos que insertan mensajes: los
  webhooks, el staff y el chat web. Repetir la regla en cada uno es la forma
  segura de que alguno la olvide.
- **RLS:** admin, gerencia y recepción. Housekeeping no lee la bandeja. El staff
  escribe sólo salientes, notas y actividad, **siempre a su nombre**
  (`autor_id = auth.uid()`). Un `entrante` escrito por el staff sería ponerle
  palabras en la boca al huésped. `anon` no tiene ningún permiso: el chat de la
  web entra por Server Action con `service_role`.
- **0126:** si el mismo email o teléfono ya escribió por otro canal, la
  identidad nueva se suma a **ese** contacto. Con más de un candidato no se
  elige.

### 3. Lo que se respeta de cada canal

- **La ventana de 24 h de Meta se decide antes de mandar**
  (`ventanaDeRespuesta`). Si no, Meta rechaza recién después, con el mensaje ya
  escrito en pantalla. WhatsApp fuera de la ventana sólo acepta plantillas.
  Instagram y Messenger aceptan hasta 7 días con `HUMAN_AGENT`, pero sólo si
  Meta aprobó el permiso (`META_HUMAN_AGENT=1`).
- **Un canal sin claves no se ofrece**: no hay simulador que diga «enviado»
  (ADR 0018). La caja de respuesta explica por qué.
- **Los avisos de entrega llegan desordenados**: `esAvanceMensaje`, la misma
  regla que `esAvance` de los correos.
- **Correo:** hace falta una clave de idempotencia propia por mensaje. La de
  `destinatario:asunto` descartaba en silencio la segunda respuesta de un mismo
  hilo («Re: …»). Además se manda `In-Reply-To` y se corta lo citado.
- **Adjuntos:** se guarda la referencia (tipo, nombre, URL si el canal da una
  pública), no el archivo. Bajarlos y guardarlos es el Storage del ADR 0013,
  que tiene retención y permisos pendientes.

### 4. Las claves: variables de entorno, un catálogo, una pantalla y un comando

Las credenciales **no se guardan en la base**, a diferencia de Chatwoot
(`channel_*`): van en variables de entorno, como el resto del sistema. Una
clave en la base la lee cualquiera con un volcado; una variable de entorno,
sólo quien administra el servidor.

- `lib/domain/integraciones.ts` es **el** catálogo. Para cada servicio dice qué
  variables lleva, cuál las enciende (`PAGO_PROVIDER`, `EMAIL_PROVIDER`…),
  dónde se consigue cada una, la URL del webhook y qué pasa si falta.
- `/panel/config/integraciones` lo muestra (cargada o no, **nunca el valor**) y
  prueba cada conexión con una consulta de solo lectura.
- `npm run integraciones` hace lo mismo desde la terminal, importando el mismo
  TypeScript (Node ≥ 22 lo carga sin compilar). Con `--plantilla` imprime el
  bloque de variables para pegar en `.env.local` o en Vercel.
- Un test de contrato exige que toda variable que lee la bandeja esté en el
  catálogo.

## Consecuencias

- El hotel puede atender WhatsApp, Instagram, Messenger, correo, Telegram y la
  web desde el panel, con el huésped y sus reservas a la vista.
- **Lo que NO se resuelve con código:**
  - la app de Meta verificada, el token permanente y la aprobación de
    plantillas;
  - el permiso Human Agent;
  - un dominio verificado en Resend con recepción (MX);
  - y que Meta, Resend y Telegram necesitan una URL **pública**: con
    `localhost` no llega ningún webhook.
- Booking y Expedia siguen sin API para un hotel suelto (ADR 0021). Su ficha lo
  dice: la solución es un channel manager (ADR 0035).
- `consultas_bot` y el chat interno (`conversaciones`) quedan como estaban. El
  asistente del portal suma «Hablar con recepción», que crea una conversación
  del canal `web`.
