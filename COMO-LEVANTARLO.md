# Blanca Patagonia — cómo levantarlo en otra computadora

## Lo que hace falta tener instalado

- **Node.js 20.12 o superior** (comprobalo con `node -v`)
- **Docker Desktop**, corriendo. Sin Docker no hay base de datos local.

## Pasos

```bash
# 1. Instalar dependencias (no vienen en el zip, se bajan solas)
npm install

# 2. Levantar la base local. La primera vez baja imágenes: tarda unos minutos.
npx supabase start

# 3. Ver las claves que imprime y crear el archivo .env.local (ver abajo)
npx supabase status

# 4. Aplicar las migraciones y los datos de ejemplo
npx supabase db  reset

# 5. Crear los usuarios del panel
#    OJO: hay que correrlo SIEMPRE después del paso 4, que borra los usuarios.
npm run seed:usuarios

# 6. Arrancar
npm run dev
```

Queda en <http://localhost:3000>

**Usuario de prueba del panel:** `admin@blancapatagonia.local` / `blancadev1234`

## El archivo `.env.local`

Crealo en la raíz del proyecto. Los valores salen de `npx supabase status`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<el PUBLISHABLE_KEY que imprime supabase status>
SUPABASE_SERVICE_ROLE_KEY=<el SECRET_KEY que imprime supabase status>
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Pasarela de pagos. En desarrollo se puede omitir: cae al simulador.
PAGO_PROVIDER=simulado
PAGO_WEBHOOK_SECRET=cualquier-cadena-larga-para-desarrollo
```

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

## Verificar que está todo bien

```bash
npm run check      # lint + typecheck + tests + build
```

Tienen que dar **1555 tests en verde, cero salteados**.

⚠️ **Leé la salida, no el código de salida.** Si no existe `.env.local`, varios
archivos de test fallan por falta de variables y el comando **igual devuelve 0**.

## Qué NO viene en el zip

- `node_modules/` — lo resuelve `npm install`
- `.next/` — lo genera el build
- `.env.local` — tiene claves; se arma a mano con el paso 3
- Los contenedores de Docker con los datos — los levanta `npx supabase start`

## Dónde leer más

| Archivo | Qué tiene |
|---|---|
| `CLAUDE.md` | El estado del proyecto, las fases y las reglas de trabajo |
| `AGENTS.md` | Comandos, arquitectura, convenciones y las trampas conocidas |
| `docs/bitacora.md` | Qué se hizo, cuándo y por qué. Es el insumo de la tesis |
| `docs/decisiones/` | Los 27 ADRs, uno por decisión de arquitectura |
| `docs/roadmap.md` | Las fases del proyecto |
