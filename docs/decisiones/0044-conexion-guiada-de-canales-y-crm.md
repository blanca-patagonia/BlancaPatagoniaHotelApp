# ADR 0044 — Conexión guiada de canales, contactos, informes y mensajes automáticos

- **Estado:** aceptada
- **Fecha:** 2026-10-21
- **Relacionadas:** ADR 0043 (la bandeja), 0018 (simuladores que fallan fuerte), 0036 (credenciales en variables de entorno, no en la base)

## Contexto

La primera versión de la bandeja (ADR 0043) ya recibía y respondía mensajes,
pero conectar un canal seguía siendo trabajo de alguien que supiera de webhooks:
entrar al panel de Meta, pegar una URL, acordarse de qué eventos suscribir,
inventar un token con `openssl`. El usuario pidió que fuera «sencillo», que se
agregara lo que faltaba de Chatwoot y que la interfaz mejorara.

Se leyó cómo lo resuelve Chatwoot en su núcleo MIT (de nuevo, sin `enterprise/`):

- **El sistema registra el webhook solo.** `Whatsapp::WebhookSetupService` llama
  a `POST /{waba}/subscribed_apps` y fija `override_callback_uri` en el número;
  `Channel::Instagram#subscribe` suscribe la cuenta por API. Nadie entra al panel
  de Meta a pegar la URL.
- **Después verifica.** `ManualWebhookStatusService` consulta a Meta si el
  número apunta a la dirección correcta y si la cuenta está suscripta.
- Las bandejas se configuran una por una: saludo, fuera de horario, horario de
  atención, asignación automática.
- Hay contactos, informes (primera respuesta, resolución) y búsqueda en mensajes.

## Decisión

### 1. «Conectar» es un botón, y a continuación hay un «Verificar»

`lib/integraciones/meta.ts` (sin importaciones, para que lo cargue también la
terminal) tiene, por canal:

- **`conectarWhatsApp` / `conectarInstagram` / `conectarMessenger`**: le dicen a
  Meta a dónde avisar y suscriben la cuenta. Devuelven **una lista de pasos**, cada
  uno ✓, ✗ o «no se pudo» (falta un dato). El total es éxito sólo si ninguno falló
  y alguno salió.
- **`crearWebhookDeCorreo`**: crea el webhook en Resend con los eventos de
  entrega **y** `email.received`, y devuelve el secreto de firma, que se muestra
  UNA vez (el sistema no puede guardarlo: las claves viven en variables de
  entorno).
- **`verificarConexion`**: no mira si hay variables cargadas —eso lo dice el
  catálogo— sino qué responde el proveedor: si la clave anda, si Meta tiene la URL
  de ESTE sistema y si la cuenta está suscripta. «Cargué las claves» y «me llegan
  los mensajes» son cosas distintas, y la diferencia son tres pasos del lado de
  Meta que nadie ve.

Antes de llamar, `urlPublicaValida` comprueba que `NEXT_PUBLIC_SITE_URL` sea
https y alcanzable desde internet. Con `localhost` el pedido sale bien y Meta
responde «no pudo verificar la URL», un mensaje que no explica que el problema
es la dirección.

### 2. Un asistente por canal, no una lista de variables

`/panel/bandeja/conectar` (una tarjeta por canal con su estado) y
`/panel/bandeja/conectar/[canal]` (cuatro pasos: conseguir los datos, cargarlos,
conectar, ajustar). Cada paso muestra su estado real. La diferencia con una lista:
la lista dice QUÉ hace falta; el asistente dice QUÉ FALTA y QUÉ HACER AHORA.

Las claves que **inventa el hotel** (`META_WEBHOOK_VERIFY_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`) las genera un botón con `crypto.getRandomValues` en el
navegador: no pasan por el servidor ni se guardan en ningún lado.

### 3. `npm run configurar`

Pregunta una clave por vez (oculta mientras se escribe), genera sola las que
inventa el hotel, la **prueba contra el proveedor antes de guardar**, la guarda en
`.env.local` (modo 600, copia en `.env.local.bak` con el mismo modo) y ofrece
conectar el canal. Para Resend, además crea el webhook y guarda el secreto solo.
Corre en la terminal de quien lo usa: las claves no pasan por ningún chat.

### 4. Contactos, informes y búsqueda en mensajes

- **Contactos** (`/panel/bandeja/contactos`): todas las personas que escribieron,
  con sus canales y si son huéspedes o interesados. Es la vista de CRM.
- **Informes**: conversaciones, esperando respuesta, primera respuesta, resolución,
  por canal y por persona. **Mediana, no promedio**: una consulta de la noche con
  9 horas de espera arrastra un promedio a «5 horas» cuando la mayoría se contesta
  en diez minutos.
- **Búsqueda en el texto de los mensajes**, con índice de trigramas.

### 5. Mensajes automáticos, en la base y no en la app

Saludo (una vez por contacto) y fuera de horario (una vez por conversación nueva,
y gana sobre el saludo: nunca salen los dos). Migración **0127**:

- **`crm_mensajes.automatico`**: un saludo NO es la respuesta de una persona. Sin
  esto, el saludo que sale a los dos segundos deja la conversación como «ya
  respondida» y el huésped espera horas sin que la lista lo marque en rojo: es el
  error que más cuesta ver, porque la pantalla dice que todo está atendido. Un eco
  (lo que el hotel escribe desde la app del teléfono) NO es automático.
- **No se contesta a casillas de máquina** (`no-reply`, `mailer-daemon`…): un
  autorresponder contestándole a otro es un bucle.
- **El horario se evalúa en la hora del hotel**, no en la del servidor (Vercel
  corre en UTC; «hasta las 21» cortaría a las 18 de El Calafate). Soporta horarios
  que cruzan la medianoche.
- **Asignación automática** dentro de `crm_registrar_entrante`, con el candado del
  contacto: hecha desde la app, dos conversaciones que entran juntas verían la
  misma carga y irían a la misma persona. Sólo recepción, y sólo conversaciones
  iniciadas por el huésped.
- **`resuelta_en`** por trigger, para el informe de resolución. Se borra al
  reabrir: el informe mide hasta la ÚLTIMA resolución.

Los envíos automáticos **nunca hacen fallar el webhook**: son accesorios, y un
saludo que no sale no justifica que Meta reintente un mensaje ya guardado.

### 6. Imágenes recibidas por WhatsApp

WhatsApp no entrega la URL del archivo, entrega un ID, y la URL que da Meta vence
a los pocos minutos: no se puede guardar. `/api/bandeja/medio/{id}` lo resuelve
cada vez, con el token del hotel. Al ser una puerta con el token, se cierra: sólo
staff de la bandeja, `id` de **sólo dígitos** (un id con barras armaría una URL a
otro recurso con el token del hotel), tipos de contenido de **lista blanca** (un
HTML o un SVG de un desconocido se baja como binario, nunca se muestra), tope de
16 MB y `nosniff` + CSP aislante en toda respuesta.

## Lo que NO está verificado

No hay credenciales de Meta, Resend ni Telegram en este entorno. Está probado
contra `fetch` simulado con las formas documentadas, y contra Postgres real todo
lo que vive en la base. **No está probado contra Meta real**, y hay un punto
concreto de riesgo: `POST /{app-id}/subscriptions`, el webhook a nivel de la app
para Instagram y Messenger. Está documentado por Meta y por varios tutoriales,
pero no se pudo abrir su página de referencia oficial. Si falla, el resultado
trae el mensaje de Meta tal cual y la guía manual da el mismo resultado pegando la
URL a mano.

Lo que ninguna pantalla puede hacer por el hotel: la app de Meta verificada, el
token permanente, las plantillas de WhatsApp aprobadas, el permiso Human Agent y
una dirección pública. Y el **correo entrante exige un subdominio**: el registro MX
de Resend REEMPLAZA al del dominio; ponerlo en el principal deja al hotel sin su
correo de siempre. El asistente lo dice de entrada.

## Lo que no se hizo

- **Enviar archivos** desde la bandeja: pide Storage (ADR 0013, con retención y
  permisos pendientes).
- **El flujo «iniciar sesión con Facebook»** (WhatsApp Embedded Signup, OAuth de
  Instagram): es lo más simple para el usuario final, pero exige una app de Meta
  aprobada con permisos avanzados y no se puede probar sin ella.
- **Presencia en línea** de las personas: por eso la asignación automática es
  opcional y advierte que no sabe quién está en turno.
- **Exportar contactos a CSV**: el resto de los listados del panel lo tiene; éste
  concentra datos personales de gente que todavía no es huésped y se dejó para
  decidirlo con el hotel.

## Consecuencias

- Conectar un canal pasa de «saber de webhooks» a cargar las claves y apretar un
  botón; y cada paso dice si salió.
- Hay una variable nueva por canal (`WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_ID`):
  son «recomendadas», no obligatorias, porque sin ellas el sistema sigue
  funcionando con el webhook pegado a mano.
- Un contrato (`tests/contratos/scripts-sin-compilar.test.ts`) vigila que los
  archivos que cargan las terminales no empiecen a importar con alias, que Node no
  resuelve: el comando se rompería sin que nada del resto del sistema lo notara.
