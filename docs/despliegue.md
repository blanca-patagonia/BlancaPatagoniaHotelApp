# Puesta en producción — Blanca Patagonia

> Entregables 8, 15 y 16 del pedido: **variables de entorno**, **instrucciones de
> despliegue** e **instrucciones de vuelta atrás**.
>
> Para levantar el sistema en una máquina de desarrollo, el instructivo es
> `COMO-LEVANTARLO.md`. Este documento es el otro: poner el sistema en internet.

---

## 0. Lo que hay que saber antes de empezar

**El sistema nunca corrió en producción.** Está escrito, probado y verificado
contra una base local, pero hay una clase de problemas que sólo aparece con
tráfico real y que ningún test puede anticipar: la latencia de red, los límites
de conexión de Supabase, un cobro por una pasarela viva, un CAE de verdad de
ARCA, y **restaurar un backup**. Este documento reduce el riesgo del despliegue;
no lo elimina.

**El despliegue lo tiene que hacer el hotel**, no quien escribió el código:
requiere las cuentas de Vercel, Supabase, la pasarela de pagos y —si se usa—
Resend y WhatsApp Business. Ninguna de esas credenciales está ni debe estar en el
repositorio.

---

## 1. Variables de entorno (entregable 8)

Todas viven en **Vercel → Project Settings → Environment Variables**. El archivo
`.env.example` tiene las mismas con su explicación larga; esta tabla es el
resumen para revisarlas de un vistazo antes de publicar.

### 1.1 Obligatorias siempre

| Variable | Qué es | Si falta |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | La app no arranca |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave publicable (`sb_publishable_…`) | La app no arranca |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta (`sb_secret_…`). **Sólo servidor** | Fallan webhooks, crons y respaldos |
| `NEXT_PUBLIC_SITE_URL` | URL pública del sitio | Los enlaces de los correos apuntan a `localhost` |
| `CRON_SECRET` | Autoriza los seis crons | **Los crons rechazan todo** (503) |

> ⚠️ La clave del **protocolo S3 del Storage** se parece a la secret y **no
> sirve**: con ésa falla todo lo que use `service_role` y el error no dice que la
> clave esté mal. La correcta está en *Project Settings → API keys*.

Generar el `CRON_SECRET` con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 1.2 Selección de proveedor — obligatorias **en producción** (ADR 0018)

Si faltan o están mal escritas, **la app falla al arrancar a propósito**. Dejar
el simulador es válido, pero hay que declararlo con su nombre: el de facturación
emite un CAE inventado sobre una factura real.

| Variable | Real | Simulador | Qué hace el simulador |
|---|---|---|---|
| `EMAIL_PROVIDER` | `resend` | `consola` | Escribe el correo en el log, no lo manda |
| `FIRMA_PROVIDER` | — | `local` | Registra una aceptación **sin validez legal** |
| `FACTURACION_PROVIDER` | — | `simulado` | **CAE inventado**, no es ARCA |
| `COTIZACION_PROVIDER` | `dolarapi` / `argentinadatos` | `manual` | Usa la cotización que cargó un admin (no inventa) |
| `CANAL_PROVIDER` | `booking-ical` | `simulado` | No habla con ninguna OTA |
| `PAGO_PROVIDER` | `mercadopago,stripe` | `simulado` | No cobra nada |

> `PAGO_PROVIDER` es el **único plural**: admite varios separados por coma,
> porque el hotel ofrece varios medios a la vez.

### 1.3 Por integración

| Integración | Variables | Notas |
|---|---|---|
| **MercadoPago** | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` | El token es también el que usa la conciliación de liquidaciones |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ⚠️ Stripe cuenta en **centavos** |
| **Pago simulado** | `PAGO_WEBHOOK_SECRET` | Sólo con `PAGO_PROVIDER=simulado` |
| **Resend (envío)** | `RESEND_API_KEY`, `EMAIL_FROM` | ⚠️ `EMAIL_FROM` debe ser de un dominio **verificado** o la API responde 403 |
| **Resend (entrega)** | `RESEND_WEBHOOK_SECRET` | Sin esto **no se detectan los rebotes**: el aviso queda «enviada» para siempre |
| **WhatsApp** | `WHATSAPP_PROVIDER`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_IDIOMA` | Ver §1.5 |
| **Booking (iCal)** | `BOOKING_ICAL_FEEDS` | Pares `CODIGO_TIPO=url` separados por comas |
| **Divisas** | `DOLARAPI_URL`, `ARGENTINADATOS_URL` | Opcionales: vacías usan las públicas |
| **Login con Google** | `AUTH_GOOGLE_HABILITADO` | `1` lo habilita |

### 1.4 De desarrollo — **no ponerlas en producción**

| Variable | Qué hace |
|---|---|
| `EMAIL_LOG_CUERPO=1` | Vuelca el cuerpo de los correos al log. Los cuerpos llevan **enlaces con token**: en producción es una fuga de credenciales de larga vida |
| `REGISTRO_SIN_BASE=1` | Apaga la escritura de errores en la tabla `errores` |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` · `ADMIN_NOMBRE` | Sólo las lee `scripts/seed-usuarios.mjs`, que además **corta si la base no es local** |

### 1.5 WhatsApp: lo que no se resuelve con una variable

`WHATSAPP_PROVIDER` vacía significa «el canal no se ofrece» y todo sale por
correo. No hay fallo al arrancar como en los otros adapters, y es a propósito: la
bandeja elige el canal **antes** de encolar, así que nada puede darse por enviado
sin haber salido.

Para que el canal funcione de verdad hacen falta tres cosas **del lado de Meta**,
y son trámites del hotel:

1. Una cuenta de **WhatsApp Business verificada** con el número del hotel.
2. Un **token permanente** de usuario de sistema. El token de prueba dura 24
   horas y sirve sólo para probar.
3. Las **plantillas aprobadas**, una por evento, con el nombre y el orden de
   huecos que declara `lib/domain/whatsapp.ts`:

   | Evento | Plantilla en Meta | Huecos, en orden |
   |---|---|---|
   | `confirmacion_reserva` | `reserva_recibida` | nombre · código · llegada · salida |
   | `reserva_confirmada` | `reserva_confirmada` | nombre · código · llegada · saldo |
   | `recordatorio_checkin` | `recordatorio_llegada` | nombre · código · llegada · hora |
   | `reserva_por_vencer` | `reserva_por_vencer` | nombre · código · seña |

> ⚠️ **El orden es el contrato.** WhatsApp numera los huecos (`{{1}}`, `{{2}}`) y
> Meta valida la **cantidad**, no el significado: si el orden de la plantilla
> aprobada no coincide con el del código, el huésped recibe el código de reserva
> donde iba la fecha **y el mensaje sale igual**.
>
> ⚠️ `es_AR` y `es` son plantillas **distintas** para Meta. Pedir una que no
> existe devuelve el error 132001 y el mensaje no sale.

---

## 2. Despliegue (entregable 15)

### 2.1 Orden

Se despliega **la base primero y la aplicación después**. Al revés, la app queda
sirviendo consultas contra columnas que todavía no existen.

### 2.2 Paso a paso

**1. La base.**

```bash
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push
```

`db push` aplica las migraciones pendientes en orden. **No usa `db reset`**, que
borra todo — ver §3.

Verificar que se aplicaron todas:

```bash
npx supabase migration list --linked
```

**2. Los datos fiscales del hotel.** La migración 0082 crea la tabla y **no la
siembra a propósito**: un CUIT inventado haría creer que ya está configurado.
Cargarlos desde `/panel/config` antes de emitir la primera factura.

**3. Las variables** de la §1, en Vercel, para el entorno *Production*.

**4. La aplicación.** Vercel despliega solo al hacer *push* a `main`. Para
forzarlo:

```bash
npx vercel --prod
```

**5. Los webhooks**, apuntando al dominio real:

| Proveedor | URL | Dónde se configura |
|---|---|---|
| MercadoPago | `https://<dominio>/api/webhooks/pagos/mercadopago` | Panel de desarrollador |
| Stripe | `https://<dominio>/api/webhooks/pagos/stripe` | Dashboard → Webhooks |
| Resend | `https://<dominio>/api/webhooks/email/resend` | Resend → Webhooks |

> ⚠️ El secreto de cada webhook es **distinto** del de la API. Copiarlo mal no da
> un error visible: el endpoint rechaza todos los eventos y el síntoma es «el
> hotel dejó de enterarse de los pagos».

**6. Los crons.** Los declara `vercel.json` y Vercel los toma del despliegue. Son
seis:

| Cron | Horario (UTC) | Qué hace |
|---|---|---|
| `/api/cron/notificaciones` | cada 5 min | Manda lo que está anotado en la bandeja |
| `/api/cron/recordatorios` | 12:00 (9 del hotel) | Decide qué recordatorios corresponden hoy |
| `/api/cron/canales` | 06:00 | Aterriza las reservas de Booking |
| `/api/cron/ari` | 06:20 | Calcula y publica disponibilidad y tarifas |
| `/api/cron/mantenimiento` | 06:40 | Expira pendientes, vence comprobantes, purga |
| `/api/cron/salud` | cada 15 min | Sondea que la base responda |

> El horario del cron de recordatorios **no es arbitrario**: 12:00 UTC son las 9
> de El Calafate, que es cuando abre la franja en la que se le puede escribir a un
> huésped. Correrlo de madrugada anotaría todo con espera hasta las 9 igual.

### 2.3 Verificación después de publicar

En este orden, y **mirando el resultado**, no el exit code:

1. `GET https://<dominio>/api/salud` → **200**. Un 503 significa que la base no
   responde: revisar las claves de Supabase antes de seguir.
2. Entrar al panel con un usuario real. Si acepta la contraseña y **vuelve al
   login**, no es la contraseña: es un perfil `sin_rol` (ver `AGENTS.md`).
3. Abrir `/panel/errores`. Debería estar vacía o con ruido menor. Un error de
   arranque repetido ahí es un proveedor mal configurado.
4. Abrir `/panel/notificaciones`. Encolar algo real —una reserva de prueba— y
   verificar que pasa de `pendiente` a `enviada` en la corrida siguiente, y de
   ahí a `entregada` cuando Resend informe.
5. Hacer **un cobro real de importe mínimo** con la pasarela viva y comprobar
   que el webhook lo acredita. La URL de retorno **no es prueba de pago**: quien
   confirma es el webhook.
6. Emitir **una factura de prueba** contra el homologación de ARCA antes de la
   primera real.

---

## 3. Vuelta atrás (entregable 16)

### 3.1 Lo primero: qué se puede deshacer y qué no

| Capa | ¿Se deshace? | Cómo |
|---|---|---|
| Aplicación | **Sí, en un minuto** | *Rollback* de Vercel al despliegue anterior |
| Migración de base | **Depende** | Ver §3.3 |
| Correo ya enviado | **No** | Ver §3.5 |
| Cobro ya acreditado | **No se borra**: se reembolsa | Desde la pasarela, y se registra el reembolso |
| Factura emitida | **No** | Se anula con una **nota de crédito** (tipos 3, 8, 13) |

### 3.2 La aplicación

En **Vercel → Deployments**, sobre el despliegue anterior, *Promote to
Production*. Vuelve en segundos y no toca la base.

Por línea de comandos:

```bash
npx vercel rollback <url-del-despliegue-anterior>
```

> ⚠️ **Volver la app atrás no vuelve la base atrás.** Si el despliegue nuevo
> traía una migración, la base sigue con la forma nueva. Casi siempre eso está
> bien —las migraciones de este proyecto agregan, no rompen— pero si la migración
> quitó o renombró algo, hay que hacer también §3.3.

### 3.3 Una migración

**No hay `down` en este proyecto, y es deliberado.** Un archivo `down` que nadie
corre nunca da una falsa sensación de reversibilidad, y el día que se necesita
resulta que estaba mal escrito. La vuelta atrás de una migración es **otra
migración**, con el número siguiente, escrita a la vista de lo que pasó.

Antes de escribirla, mirar qué tipo de cambio fue:

- **Agregó una columna, una tabla o un índice** → normalmente **no hace falta
  revertir**: la app vieja no la usa y no molesta. Es el caso de casi todas las
  migraciones de este sistema.
- **Cambió un `check` o una política RLS** → la migración de vuelta atrás
  restaura el estado anterior. Está escrito en el encabezado de cada migración
  qué reemplazó.
- **Borró o renombró algo** → los datos ya no están. Acá **el único camino es
  restaurar el backup**, §3.4.

> ⚠️ **Nunca `npx supabase db reset` contra producción.** Borra la base entera,
> incluidos los usuarios de auth. El hook de este repositorio lo bloquea, y por
> eso.
>
> ⚠️ **Dos migraciones con el mismo número no conviven.** Supabase registra la
> versión por el prefijo, da la segunda por aplicada y **la saltea en silencio**.
> Antes de elegir un número: `git fetch` y mirar el último.

### 3.4 Restaurar un backup

Los backups los hace **la plataforma** (Supabase → Database → Backups), no la
aplicación. Lo que hay en `/panel/respaldos` es una **exportación de datos
operativos** y la pantalla lo aclara: no es un backup de Postgres y no sirve para
restaurar.

El procedimiento es el de Supabase: *Point-in-time recovery* si el plan lo
incluye, o restaurar el backup diario.

> ⚠️ **Esto nunca se probó.** Es el punto ciego más grande que queda, y está
> anotado como tal en `docs/PENDIENTES.md`. Un backup que no se restauró nunca es
> una suposición, no un respaldo. **Conviene probarlo en un proyecto de Supabase
> descartable antes de necesitarlo de verdad**, que es el peor momento para
> descubrir que algo falta.

### 3.5 Lo que ya salió del sistema

Un correo o un WhatsApp enviado **no se puede deshacer**. Si un despliegue mandó
avisos equivocados:

1. **Frenar la fuente**, no la salida: en Vercel, sacar temporalmente
   `CRON_SECRET`. Los crons pasan a responder 503 y dejan de encolar. La bandeja
   queda quieta; nada se pierde.
2. Marcar como `cancelada` lo que todavía está `pendiente` en
   `/panel/notificaciones`. Lo cancelado no sale y se puede reencolar después.
3. Reponer `CRON_SECRET` cuando el problema esté resuelto.

> Ese orden importa: apagar el cron de notificaciones **antes** de tocar la
> bandeja evita que una corrida se lleve justo lo que se está por cancelar.

### 3.6 Rollback del service worker

⚠️ **Un service worker roto no se arregla con un deploy**: queda instalado en el
dispositivo de cada persona y sigue interceptando pedidos con la versión vieja.
El procedimiento de apagado está escrito en el encabezado de `public/sw.js` —hay
que publicar un service worker vacío que se desregistre— y `next.config.ts` le
pone `Cache-Control: no-store` justamente para que ese reemplazo se pueda
publicar (ADR 0028).

---

## 4. Después del primer despliegue

Lo que conviene mirar la primera semana, en orden de importancia:

1. **`/panel/errores`** todos los días. Un error repetido es configuración; uno
   aislado es ruido.
2. **`/panel/notificaciones`**, filtrando por *Fallida*. Si hay rebotes, son
   direcciones mal cargadas y se arreglan de a una.
3. **`/panel/conciliacion`** a fin de mes, contra el extracto del banco en papel.
4. Que **el contador correlativo de facturas no salte**. Si salta, algo está
   pidiendo números y no los usa.

Y lo que sigue sin poder cerrarse desde el código, para tenerlo presente:
latencia real, límites de conexión, un CAE de verdad y **restaurar un backup**.
