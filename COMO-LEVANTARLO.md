# Blanca Patagonia — cómo levantarlo en otra computadora

El sistema usa un proyecto **Supabase en la nube**: la base ya está creada, con las
67 migraciones aplicadas y el catálogo cargado. **No hace falta Docker para usar el
sistema.**

Docker sigue haciendo falta para **una sola cosa**: correr la suite de tests. Está
explicado más abajo, y conviene leer esa sección antes de correr `npm test`.

## Lo que hace falta tener instalado

- **Node.js 20.12 o superior** (comprobalo con `node -v`)
- Nada más para levantar el sistema.
- *(Opcional)* **Docker Desktop**, solo si vas a correr los tests.

## Pasos

```bash
# 1. Instalar dependencias (no vienen en el zip, se bajan solas)
npm install

# 2. Crear el archivo .env.local con las claves del proyecto (ver abajo)

# 3. Arrancar
npm run dev
```

Queda en <http://localhost:3000>

Para confirmar que enganchó con la base, entrá a <http://localhost:3000/api/salud>.
Tiene que responder `{"estado":"ok","base":"ok"}`.

## El archivo `.env.local`

Crealo en la raíz del proyecto. **No se versiona** (está en `.gitignore`), así que
en cada computadora hay que armarlo a mano.

Los valores salen del panel de Supabase, en **Project Settings → API keys**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<tu-proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<la "publishable key", empieza con sb_publishable_>
SUPABASE_SERVICE_ROLE_KEY=<la "secret key", empieza con sb_secret_>
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Pasarela de pagos. En desarrollo se puede omitir: cae al simulador.
PAGO_PROVIDER=simulado
PAGO_WEBHOOK_SECRET=cualquier-cadena-larga-para-desarrollo
```

⚠️ **Cuidado con cuál copiás.** La *secret key* es la que empieza con `sb_secret_`.
En el panel hay además una clave del protocolo S3 del Storage que se parece y **no
sirve**: con ésa, todo lo que use `service_role` falla —incluida el alta de
usuarios— y el error no dice que la clave esté mal.

La *publishable key* sí es pública: viaja al navegador por diseño. La *secret key*
no sale nunca del servidor.

## Entrar al panel

Andá a <http://localhost:3000/panel> y entrá con tu usuario y contraseña.

**Los usuarios ya están en la base.** Viven en el proyecto de Supabase, así que
son los mismos desde cualquier computadora: no hay nada que crear ni que sembrar
para empezar a trabajar.

Si necesitás una cuenta, pedísela a un administrador —se dan de alta desde
**`/panel/usuarios`**—. Y si perdiste la contraseña, hay recuperación por email
en **`/login/recuperar`**.

## Correr los tests — acá sí hace falta Docker

**Los tests NO se corren contra el proyecto de la nube.** Hay 24 archivos que
escriben con `service_role`, que saltea RLS, y borran filas de `reservas`,
`huespedes`, `tarifas`, `unidades` y `tipos_unidad`. Contra la base real eso
destruye datos del hotel.

Por eso hay que levantar una base local para testear:

```bash
npx supabase start          # la primera vez baja imágenes: tarda unos minutos
npx supabase db reset       # aplica las 67 migraciones y el catálogo
npm run seed:usuarios       # OJO: db reset borra los usuarios de auth

# y recién ahí, con las variables apuntando a LOCAL:
npm test
```

`tests/db.ts` tiene una guarda que corta si las variables apuntan a una base que no
es local, así que el accidente no puede pasar en silencio.

Sin base local, `npm test` **saltea** los tests de integración en vez de fallar
—entre ellos el anti-overbooking, que es la garantía central del sistema—. En CI
eso no puede pasar: `EXIGIR_DB=1` convierte la ausencia de base en error.

## Verificar que está todo bien

```bash
npm run check      # lint + typecheck + tests + build
```

Con base local tienen que dar **1555 tests en verde, cero salteados**.

⚠️ **Leé la salida, no el código de salida.** Si no existe `.env.local`, varios
archivos de test fallan por falta de variables y el comando **igual devuelve 0**.

## Para probar el cobro de punta a punta

1. Entrá a <http://localhost:3000/reservar> y hacé una reserva.
2. En la pantalla de confirmación tocá **«Pagar la seña»**.
3. Elegí **«Pago simulado»** y después **«Aprobar el pago»**.
4. La reserva pasa a **confirmada** sola. Si pagás el saldo completo, pasa a **pagada**.

La pantalla del simulador avisa en grande que no se mueve dinero. Dispara el
webhook real firmado con HMAC, así que lo que se prueba es el mismo código que va
a correr en producción, no un atajo.

## Para conectar las pasarelas de verdad

No hay que tocar código. Se cargan estas variables:

```
PAGO_PROVIDER=mercadopago,stripe        # varias, separadas por comas

MERCADOPAGO_ACCESS_TOKEN=...
MERCADOPAGO_WEBHOOK_SECRET=...

STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Y registrar estas URLs en el panel de cada pasarela:

```
https://<tu-dominio>/api/webhooks/pagos/mercadopago
https://<tu-dominio>/api/webhooks/pagos/stripe
```

**Por qué dos pasarelas y no una:** el hotel es internacional. Stripe cobra en
dólares y toma cualquier tarjeta del exterior más Apple Pay y Google Pay;
MercadoPago cobra en pesos con cuotas, débito, billetera y **efectivo en Rapipago
y Pago Fácil**, que ninguna pasarela internacional ofrece. Con una sola, la mitad
de los huéspedes se queda sin poder pagar.

El detalle y el porqué de cada decisión está en
`docs/decisiones/0027-cobro-en-linea-dos-pasarelas-y-una-sola-moneda-de-saldo.md`.

## Variables obligatorias en producción

Si faltan, el sistema **falla al arrancar a propósito** (ADR 0018): quedarse con un
simulador tiene que ser una decisión escrita, nunca un descuido. El de facturación,
por ejemplo, emite un CAE inventado sobre una factura real.

```
EMAIL_PROVIDER, FIRMA_PROVIDER, FACTURACION_PROVIDER,
COTIZACION_PROVIDER, CANAL_PROVIDER, PAGO_PROVIDER
```

La plantilla completa, con el nombre del simulador de cada una, está en
`.env.example`.

## Apéndice: crear el primer administrador de una base nueva

**Esto no hace falta para el uso normal.** El proyecto de Supabase que se usa hoy
ya tiene sus usuarios: si estás levantando el sistema en otra computadora, saltealo.

Sirve para un solo caso: una base **recién creada, sin ningún usuario todavía**.
Como el staff no se auto-registra y las cuentas se dan de alta desde
`/panel/usuarios`, hay un problema del huevo y la gallina — no hay nadie que pueda
entrar a crear al primero. Este script lo resuelve.

En **Windows**, que es donde se trabaja este proyecto, las variables se setean
aparte: la sintaxis `VAR=valor comando` es de bash y no funciona.

```cmd
:: cmd — SIN comillas: en CMD quedan DENTRO del valor y la contraseña saldría mal
set ADMIN_EMAIL=tu-mail@dominio.com
set ADMIN_PASSWORD=una-larga-y-propia
npm run seed:usuarios
```

```powershell
# PowerShell — acá las comillas sí van
$env:ADMIN_EMAIL = "tu-mail@dominio.com"
$env:ADMIN_PASSWORD = "una-larga-y-propia"
npm run seed:usuarios
```

```bash
# macOS / Linux
ADMIN_EMAIL="tu-mail@dominio.com" ADMIN_PASSWORD="una-larga-y-propia" npm run seed:usuarios
```

Contra una base que no sea local el script **exige** `ADMIN_PASSWORD` y se niega a
correr sin ella. Hace bien: la contraseña de desarrollo está publicada en este
repositorio, que es público.

Se corre **una sola vez**. El usuario queda en la base —contraseña hasheada en
`auth.users`, rol en `perfiles`— y de ahí en adelante se entra normal. El único
lugar donde se repite seguido es la base local de tests, porque `db reset` borra
los usuarios de auth.

⚠️ **Crear el usuario desde el panel de Supabase no alcanza, y el síntoma
confunde:** el login te acepta las credenciales y te devuelve al login, una y otra
vez, como si la contraseña estuviera mal. No lo está. El perfil nace `sin_rol` y
`activo = false` a propósito (ADR 0017, migraciones 0032 y 0035): la autenticación
pasa, pero `obtenerSesion()` descarta la sesión y el panel te rebota. El script es
el que promueve el perfil a `admin`. Para confirmarlo, en el SQL Editor:

```sql
select u.email, p.rol, p.activo
from perfiles p join auth.users u on u.id = p.id;
```

## Qué NO viene en el zip

- `node_modules/` — lo resuelve `npm install`
- `.next/` — lo genera el build
- `.env.local` — tiene claves; se arma a mano con el paso 2

## Dónde leer más

| Archivo | Qué tiene |
|---|---|
| `CLAUDE.md` | El estado del proyecto, las fases y las reglas de trabajo |
| `AGENTS.md` | Comandos, arquitectura, convenciones y las trampas conocidas |
| `docs/bitacora.md` | Qué se hizo, cuándo y por qué. Es el insumo de la tesis |
| `docs/decisiones/` | Los 27 ADRs, uno por decisión de arquitectura |
| `docs/roadmap.md` | Las fases del proyecto |
