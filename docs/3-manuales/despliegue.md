# Puesta en producción — Blanca Patagonia

> Entregables 8, 15 y 16 del pedido: **variables de entorno**, **instrucciones de
> despliegue** e **instrucciones de vuelta atrás**.
>
> Para levantar el sistema en una máquina de desarrollo, el instructivo es
> `COMO-LEVANTARLO.md`. Este documento es el otro: poner el sistema en internet.
>
> Rama `tesis-a-presentar` (versión reducida, ADR 0045): las variables y los pasos
> de los módulos quitados (canales de venta, firma de contratos, WhatsApp, claves
> de la bandeja, respaldos) ya no figuran. La base de datos conserva sus tablas.

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
Resend. Ninguna de esas credenciales está ni debe estar en el
repositorio.

**Hace falta el plan Pro de Vercel**, no el gratuito (Hobby). `vercel.json`
declara dos crons que corren varias veces por día —la bandeja de avisos cada 5
minutos y el sondeo de salud cada 15—, y Hobby sólo admite crons **diarios**:
con esos horarios el despliegue se rechaza. Bajarlos a uno por día para entrar
en Hobby no es una salida: los avisos saldrían una vez al día (una confirmación
de reserva llegaría al otro día) y el tablero marcaría la bandeja como atrasada
todo el tiempo, porque su tolerancia es de 30 minutos (`src/lib/domain/crons.ts`).

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
| `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta (`sb_secret_…`). **Sólo servidor** | Fallan los webhooks, los crons y el alta pública de reservas |
| `NEXT_PUBLIC_SITE_URL` | URL pública del sitio | Los enlaces de los correos apuntan a `localhost` |
| `CRON_SECRET` | Autoriza los tres crons | **Los crons rechazan todo** (503) |

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
| `FACTURACION_PROVIDER` | — | `simulado` | **CAE inventado**, no es ARCA |
| `COTIZACION_PROVIDER` | `dolarapi` / `argentinadatos` | `manual` | Usa la cotización que cargó un admin (no inventa) |
| `PAGO_PROVIDER` | `mercadopago,stripe,payway` | `simulado` | No cobra nada |

> `PAGO_PROVIDER` es el **único plural**: admite varios separados por coma,
> porque el hotel ofrece varios medios a la vez.

### 1.3 Por integración

| Integración | Variables | Notas |
|---|---|---|
| **MercadoPago (cobro)** | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` | Cómo conseguirlas: §1.5 |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ⚠️ Stripe cuenta en **centavos**. ⚠️ No admite cuentas de Argentina directas, ver §1.5 |
| **Payway** (ADR 0038) | `PAYWAY_PUBLIC_KEY`, `PAYWAY_PRIVATE_KEY`, `PAYWAY_INTERNAL_SECRET` | ⚠️ Payway también cuenta en **centavos**. `PAYWAY_INTERNAL_SECRET` no es de Payway: firma el evento que el propio servidor se manda a sí mismo tras una respuesta síncrona (ver `src/lib/payments/payway.ts`). Cómo conseguirlas: §1.5 |
| **Pago simulado** | `PAGO_WEBHOOK_SECRET` | Sólo con `PAGO_PROVIDER=simulado` |
| **Resend (envío)** | `RESEND_API_KEY`, `EMAIL_FROM` | ⚠️ `EMAIL_FROM` debe ser de un dominio **verificado** o la API responde 403 |
| **Divisas** | `DOLARAPI_URL`, `ARGENTINADATOS_URL`, `AMBITO_URL` | Opcionales: vacías usan las públicas. `AMBITO_URL` es solo para el dato informativo de Banco Nación del dashboard (no participa del cobro); si Ámbito no responde, esa fila del widget simplemente no aparece |
| **Login con Google** | `AUTH_GOOGLE_HABILITADO` | `1` lo habilita. Además hay que configurar el proveedor en Supabase, ver §2.2 paso 4 |
| **Asistente del portal público** | `ASISTENTE_PROVIDER` | Opcional. El único valor es `reglas`, que es también el que se usa si falta (ADR 0011: el portal no usa un modelo de IA, a propósito) |

### 1.4 De desarrollo — **no ponerlas en producción**

| Variable | Qué hace |
|---|---|
| `EMAIL_LOG_CUERPO=1` | Vuelca el cuerpo de los correos al log. Los cuerpos llevan **enlaces con token**: en producción es una fuga de credenciales de larga vida |
| `REGISTRO_SIN_BASE=1` | Apaga la escritura de errores en la tabla `errores` |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` · `ADMIN_NOMBRE` | Sólo las lee `scripts/seed-usuarios.mjs`, que además **corta si la base no es local** |

### 1.5 Pasarelas de pago: qué trámite hace falta para cada una

El código de las cuatro está escrito (`src/lib/payments/`); lo que falta en los
cuatro casos es el trámite comercial, no programar. Investigado el
2026-09-14 para tenerlo a mano cuando el hotel decida contratar. Nada de esto
se probó contra una cuenta real todavía (ver ADR 0027 y ADR 0038): antes de
activar cualquiera en producción, conviene un pago de prueba chico primero.

#### Mercado Pago

Las credenciales de cobro:

| Variable | Para qué | De dónde sale |
|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` + `MERCADOPAGO_WEBHOOK_SECRET` | Cobrar de verdad (Checkout Pro, `src/lib/payments/mercadopago.ts`) | Credenciales de **producción** de la cuenta de cobro del hotel, en `mercadopago.com.ar/developers/panel/app` → la aplicación → «Credenciales de producción». El webhook secret se genera al configurar la URL de notificaciones dentro de esa misma aplicación (menú Webhooks → Configurar notificaciones → pestaña «Modo productivo», poner `https://<dominio>/api/webhooks/pagos/mercadopago`) |

⚠️ **Requisito previo:** una cuenta de
Mercado Pago dada de alta como **vendedor**, lo que pide CUIT/CUIL y
Monotributo o el régimen fiscal que corresponda al hotel — es un trámite del
hotel, no de quien programa. Y para que Mercado Pago habilite las
credenciales de **producción** (no solo las de prueba) pide un sitio HTTPS
real: no se puede activar contra `localhost`.

#### Payway (Prisma) — es un trámite telefónico, no un formulario web

1. **Abrir cuenta Payway**, si el hotel no tiene una: por teléfono,
   `4378-4440` (CABA/GBA) o `0810-222-4440` (interior), de lunes a viernes de
   10 a 18h. Hace falta estar inscripto como empresa (hay una modalidad
   aparte para monotributista/persona física, «cuenta persona física»).
2. **Pedir la activación de «venta online»** sobre esa cuenta — no viene
   activada por default, es un establecimiento aparte («Mis
   establecimientos» → «Agregar nuevo establecimiento» → «Online» o «Link de
   pago», una vez que ya se tiene el panel Mi Payway).
3. **Pedir acceso al portal de desarrolladores** (`developers.payway.com.ar`)
   y las claves —pública y privada— escribiendo a
   **soporte@payway.com.ar**. Ahí es donde conviene preguntar explícitamente
   por las dos cosas que el código dejó sin confirmar (ver el docblock de
   `src/lib/payments/payway.ts` y el ADR 0038):
   - el nombre exacto del header de autenticación de la API REST (el código
     usa `apikey`, que es lo que documentan los SDKs públicos, pero no se
     verificó contra una respuesta real),
   - la URL base de producción correcta para la cuenta contratada
     (`ventasonline.payway.com.ar/api/v2` según el SDK de JavaScript,
     `live.decidir.com` según el SDK de PHP — son la marca vieja y la nueva
     del mismo gateway, y probablemente una sola resuelva para la cuenta
     real).
4. **Pedir un usuario de sandbox** para probar antes de salir a producción —
   existe («Developer Sandbox», con credenciales de prueba propias) y también
   se gestiona con Soporte.
5. Soporte técnico de terminales (si el hotel usa un posnet físico Payway
   además del cobro online): `0800-333-1258`, todos los días de 8 a 21h.

#### Stripe — ⚠️ no tiene alta directa para una empresa argentina

Esto cambia si conviene activarlo o no, y es una decisión del hotel, no un
trámite técnico: **Stripe no admite cuentas registradas en Argentina** (no
está en su lista de países soportados). El camino que existe hoy para una
empresa argentina es indirecto:

- Constituir una entidad en un país donde Stripe sí opera (EE.UU. es lo más
  común — una LLC con su EIN, Reino Unido, etc.) y abrir la cuenta de Stripe
  con esa entidad, no con el CUIT del hotel; o
- Usar un intermediario/plataforma que ya tenga cuenta Stripe habilitada y
  liquide al hotel por otro medio.

Ninguna de las dos es «cargar una variable de entorno». Antes de invertir
tiempo en conseguir `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` de verdad,
vale la pena que el hotel confirme si quiere ir por ese camino — el huésped
que paga con Stripe hoy en el sistema es el que paga desde el exterior, y
Mercado Pago con tarjeta internacional cubre buena parte del mismo caso sin
ese trámite.


---

## 2. Despliegue (entregable 15)

### 2.1 Orden

Se despliega **la base primero y la aplicación después**. Al revés, la app queda
sirviendo consultas contra columnas que todavía no existen.

### 2.2 Paso a paso

**1. La base.** No es sólo `db push`: la base de la nube se fue armando de a
poco y puede tener migraciones aplicadas sin anotar, o anotadas sin aplicar.
`db push` confía en lo anotado, así que hay que mirar primero.

*a. Probar la restauración de un backup* (§3.4) en un proyecto descartable,
**antes** de seguir. La 0107 y la 0108 borran tipos de unidad, unidades
ficticias y sus tarifas en cascada; si algo sale mal, eso sólo vuelve
restaurando.

*b. Ver qué está anotado y qué existe de verdad:*

```bash
npx supabase link --project-ref <ref-del-proyecto>
npx supabase migration list --linked

ESQUEMA_DB_URL='postgresql://postgres:<contraseña>@db.<ref>.supabase.co:5432/postgres' \
  npm run esquema:comparar
```

`migration list` dice qué se **anotó**, no qué se aplicó: el 2026-10-20 la base
local tenía anotada la 0087 sin su tabla, y otras doce aplicadas sin anotar.
`esquema:comparar` compara el esquema real contra el de las migraciones (ADR
0042): «FALTA» son migraciones sin aplicar; «SOBRA», objetos que no vienen de
ninguna.

*c. Anotar lo que ya está aplicado.* Una migración que figura pendiente en
`migration list` pero cuyos objetos **ya existen** según `esquema:comparar` hay
que marcarla, porque `db push` la volvería a correr y la mayoría no se puede
repetir (`create table` sin `if not exists`, `add column`):

```bash
npx supabase migration repair --status applied <versión>
```

⚠️ **Sólo después de comprobar que sus objetos existen.** Marcar como aplicada
una migración que no lo está la saltea para siempre, sin ningún error.

*d. El caso de la 0107.* Si la 0107 figura pendiente y la base todavía tiene las
cabañas ficticias del catálogo representativo («Cabaña Lenga», «Ñire»,
«Calafate», «Notro», «Coihue»), la 0107 se corta con un error de FK, y `db push`
**no aplica nada de lo que sigue** —entre eso, la 0119—. Antes del push, correr
a mano (SQL Editor de Supabase) el **primer bloque `do $$ … end $$`** de la
`0108_*.sql`, que borra esas cinco unidades o las da de baja si tienen
historial. No editar la 0107: ya está aplicada en otras bases.

*e. Aplicar y volver a comparar:*

```bash
npx supabase db push
ESQUEMA_DB_URL='…' npm run esquema:comparar
```

`db push` aplica las pendientes en orden. **Nunca `db reset`**, que borra todo —
ver §3. Repetir la comparación hasta que diga «✓ El esquema coincide». ⚠️ En
particular, confirmar que la **0119** quedó aplicada: sin ella, en una base
nueva el rol público (`anon`, con la clave que viaja en el navegador) puede
ejecutar funciones como `crear_reserva` o `registrar_acceso_huesped`.

**2. Los datos fiscales del hotel.** La migración 0082 crea la tabla y **no la
siembra a propósito**: un CUIT inventado haría creer que ya está configurado.
Cargarlos desde `/panel/config` antes de emitir la primera factura.

**3. Las variables** de la §1, en Vercel, para el entorno *Production*.

**4. Las URLs de autenticación.** Sin esto el login con contraseña funciona,
pero la **recuperación de contraseña** y el **login con Google** devuelven a
`localhost` o los rechaza Supabase:

| Dónde | Qué cargar |
|---|---|
| Supabase → Authentication → URL Configuration → *Site URL* | `https://<dominio>` |
| Supabase → Authentication → URL Configuration → *Redirect URLs* | `https://<dominio>/auth/callback` (Google) y `https://<dominio>/login/nueva-contrasena` (recuperar contraseña) |
| Supabase → Authentication → Providers → Google | El *Client ID* y *Client Secret* de Google Cloud; en Google Cloud, como URI de redirección autorizada, la que muestra Supabase ahí (`https://<ref>.supabase.co/auth/v1/callback`) |

`<dominio>` tiene que ser exactamente el de `NEXT_PUBLIC_SITE_URL`: el código
arma las URLs de vuelta con esa variable.

**5. La aplicación.** Vercel despliega solo al hacer *push* a `main`. Para
forzarlo:

```bash
npx vercel --prod
```

**6. Los webhooks**, apuntando al dominio real:

| Proveedor | URL | Dónde se configura |
|---|---|---|
| MercadoPago | `https://<dominio>/api/webhooks/pagos/mercadopago` | Panel de desarrollador |
| Stripe | `https://<dominio>/api/webhooks/pagos/stripe` | Dashboard → Webhooks |

> ⚠️ El secreto de cada webhook es **distinto** del de la API. Copiarlo mal no da
> un error visible: el endpoint rechaza todos los eventos y el síntoma es «el
> hotel dejó de enterarse de los pagos».

**7. Los crons.** Los declara `vercel.json` y Vercel los toma del despliegue.
Requieren el plan **Pro** (§0): dos corren varias veces por día. Son tres:

| Cron | Horario (UTC) | Qué hace |
|---|---|---|
| `/api/cron/notificaciones` | cada 5 min | Manda lo que está anotado en la bandeja |
| `/api/cron/mantenimiento` | 06:40 | Expira reservas pendientes y purga errores viejos |
| `/api/cron/salud` | cada 15 min | Sondea que la base responda |


### 2.3 Verificación después de publicar

En este orden, y **mirando el resultado**, no el exit code:

1. `GET https://<dominio>/api/salud` → **200**. Un 503 significa que la base no
   responde: revisar las claves de Supabase antes de seguir.
2. Entrar al panel con un usuario real. Si acepta la contraseña y **vuelve al
   login**, no es la contraseña: es un perfil `sin_rol` (ver `AGENTS.md`).
3. Abrir `/panel/errores`. Debería estar vacía o con ruido menor. Un error de
   arranque repetido ahí es un proveedor mal configurado.
4. Encolar algo real —una reserva de prueba— y verificar en la tabla
   `notificaciones` que pasa de `pendiente` a `enviada` en la corrida siguiente.
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
aplicación: el sistema no tiene ninguna pantalla ni botón de respaldo.

El procedimiento es el de Supabase: *Point-in-time recovery* si el plan lo
incluye, o restaurar el backup diario.

> ⚠️ **Esto nunca se probó.** Es el punto ciego más grande que queda, y está
> anotado como tal en `docs/5-pendientes/PENDIENTES.md`. Un backup que no se restauró nunca es
> una suposición, no un respaldo. **Hay que probarlo en un proyecto de Supabase
> descartable antes del primer `db push`** (§2.2 paso 1a), no cuando se lo
> necesite: la 0107 y la 0108 borran tipos de unidad y unidades con sus
> tarifas, y eso no tiene otra vuelta atrás que restaurar.
>
> Cómo probarlo: restaurar el backup más reciente en el proyecto descartable,
> apuntar una copia local de la app a ese proyecto y verificar que se ven las
> reservas, los huéspedes y las facturas de los últimos días, y que el login
> funciona (los usuarios de auth también tienen que volver).

### 3.5 Lo que ya salió del sistema

Un correo enviado **no se puede deshacer**. Si un despliegue mandó
avisos equivocados:

1. **Frenar la fuente**, no la salida: en Vercel, sacar temporalmente
   `CRON_SECRET`. Los crons pasan a responder 503 y dejan de encolar. La bandeja
   queda quieta; nada se pierde.
2. Marcar como `cancelada` lo que todavía está `pendiente` en la tabla
   `notificaciones`. Lo cancelado no sale y se puede reencolar después.
3. Reponer `CRON_SECRET` cuando el problema esté resuelto.

> Ese orden importa: apagar el cron de notificaciones **antes** de tocar la
> bandeja evita que una corrida se lleve justo lo que se está por cancelar.


---

## 4. Después del primer despliegue

Lo que conviene mirar la primera semana, en orden de importancia:

1. **`/panel/errores`** todos los días. Un error repetido es configuración; uno
   aislado es ruido.
2. Que **el contador correlativo de facturas no salte**. Si salta, algo está
   pidiendo números y no los usa.

Y lo que sigue sin poder cerrarse desde el código, para tenerlo presente:
latencia real, límites de conexión, un CAE de verdad y **restaurar un backup**.
