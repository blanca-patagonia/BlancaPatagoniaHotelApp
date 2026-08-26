# Puesta en marcha

---

## Lo que hace falta

| | |
|---|---|
| **Node.js** | ≥ 20.12 (el CI usa **22**, la LTS vigente) |
| **Docker** | Para la base local con Supabase. Sin Docker el sistema arranca, pero **43 tests se saltean** — entre ellos el anti-overbooking |
| **Git** | — |

No hace falta una cuenta de Supabase: la base corre local, en contenedores.

---

## Arrancar

```bash
git clone https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp.git
cd BlancaPatagoniaHotelApp

npm run setup     # instala y dice qué falta y cómo resolverlo
npx supabase start
npm run seed:usuarios
npm run dev
```

La aplicación queda disponible en http://localhost:3000. El administrador de
desarrollo es
`admin@blancapatagonia.local` / `blancadev1234` — es del stack local y la
contraseña es pública a propósito.

El paso a paso completo, con los errores más comunes, está en
[`COMO-LEVANTARLO.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/COMO-LEVANTARLO.md).

| Servicio local | Dirección |
|---|---|
| Aplicación | http://localhost:3000 |
| API de Supabase | http://127.0.0.1:54321 |
| Studio (ver la base) | http://127.0.0.1:54323 |

---

## Comandos

| Acción | Comando |
|---|---|
| Desarrollo | `npm run dev` |
| **Verificación completa** | **`npm run check`** — lint + typecheck + tests + build |
| Tests | `npm test` · uno solo: `npm test -- <patrón>` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Rehacer la base | `npx supabase db reset` ⚠️ **borra los usuarios de auth** |
| Sembrar usuarios | `npm run seed:usuarios` |
| Salud del sistema | `GET /api/salud` — 200 si la base responde, 503 si no |

> **Antes de dar por terminado un cambio, debe ejecutarse `npm run check`.**

---

## ⚠️ Las dos trampas de los tests

Ambas hacen que el sistema parezca verificado cuando no lo está. Conviene leerlas
antes de la primera ejecución.

### 1. `npm run check` devuelve 0 con tests en rojo

Sin `.env.local`, tres archivos fallan por falta de `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY`, y el código de salida **igual da 0**.

**Debe leerse la salida, no el código de salida.**

### 2. Faltan **tres** variables, y la tercera se olvida

Vitest no lee `.env.local`. `EXIGIR_DB=1` convierte la ausencia de base en un
error, pero mira la conexión de servicio, **no la clave publicable**: sin
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, los cuatro tests del borde público —los que
verifican que `anon` no puede ver el precio neto— **se saltean en silencio**.

Para correr los 1555 tests de verdad:

```bash
EXIGIR_DB=1 \
SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_SERVICE_ROLE_KEY="sb_secret_…" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_…" \
npm test
```

Las claves salen de `npx supabase status`. En CI las tres se exportan solas.

---

## Qué corre en cada push

| Workflow | Qué verifica |
|---|---|
| **CI** | Levanta Postgres con Docker, crea el admin y corre `npm audit`, typecheck, lint, la suite completa con `EXIGIR_DB=1` y el build |
| **CodeQL** | Análisis estático de seguridad del código propio |
| **Revisión de dependencias** | Falla si el PR **agrega** una dependencia con vulnerabilidad alta o crítica |

Dos cosas del CI que hay que respetar si se lo toca:

1. El paso del seed invoca **`node scripts/seed-usuarios.mjs` directo**, no el
   script de npm (ése usa `--env-file-if-exists`, que no aplica en el runner).
2. **Sin ese paso, la tabla `perfiles` queda vacía** y los tests de facturación
   fallan por la clave foránea de «quién emitió». Fue la causa de que este workflow
   no terminara en verde durante mucho tiempo.

---

## Estructura del repositorio

```
app/            # Next.js App Router
  panel/        #   gestión hotelera (staff, por rol) — 21 áreas
  alojamientos/ #   catálogo público con detalle por tipo
  reservar/     #   portal público de reservas
  firmar/       #   firma de contratos por token
  encuesta/     #   encuesta de satisfacción por token
  portal/       #   portal de agencias y proveedores por token
  api/          #   route handlers, webhooks y cron
lib/            # dominio puro, disponibilidad, pagos, canales, divisas, Supabase
supabase/       # 67 migraciones SQL numeradas + seed
docs/           # documentación del proyecto y de la tesis
tests/          # 1555 tests (Vitest)
```

---

## Deploy

**Pendiente**, porque requiere cuentas del hotel: Vercel para la aplicación y
Supabase cloud para la base.

⚠️ **Variables obligatorias en producción.** Si faltan, el sistema **falla al
arrancar, a propósito** ([ADR 0018](Decisiones-de-arquitectura)):

`EMAIL_PROVIDER` · `FIRMA_PROVIDER` · `FACTURACION_PROVIDER` ·
`COTIZACION_PROVIDER` · `CANAL_PROVIDER` · `PAGO_PROVIDER`

`PAGO_PROVIDER` es el único que admite **varias separadas por comas**
(`mercadopago,stripe`). Con las pasarelas van además
`MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` y
`STRIPE_WEBHOOK_SECRET`.

Opcionales: `BOOKING_ICAL_FEEDS`, `DOLARAPI_URL`, `ARGENTINADATOS_URL`.

La lista completa está en
[`.env.example`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/.env.example).
Hay que revisarlas **antes** del deploy, no después.

---

## Para quien vaya a escribir código

Corresponde leer [`AGENTS.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/AGENTS.md)
—arquitectura, convenciones y trampas— y
[`CONTRIBUTING.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/CONTRIBUTING.md).

Las tres reglas que más se pasan por alto:

1. **Ningún `{ error }` de Supabase se descarta.** Un `insert` que falla sin avisar
   deja la pantalla recargando sin cambios, y quien la usa no puede distinguir «no
   se pudo» de «no pasó nada». Había 38 casos así; hoy hay **cero**.
2. **Toda página y acción del panel verifica el rol** con `requerirAcceso(area)`.
3. **Un bugfix entra con el test que fallaba antes del fix.**
