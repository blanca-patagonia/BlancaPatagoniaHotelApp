# Puesta en marcha

---

## Lo que hace falta

| | |
|---|---|
| **Node.js** | ≥ 20.12 (el CI usa **22**, la LTS vigente: `.nvmrc`) |
| **Un proyecto de Supabase** | La base es un proyecto en la nube, con las migraciones y el catálogo ya aplicados. No hay que levantar Docker para usar el sistema |
| **Docker** | Sólo para correr los tests. Sin Docker el sistema arranca, pero **583 de los 1780 tests se saltean** — entre ellos el anti-overbooking |
| **Git** | — |

---

## Arrancar

```bash
git clone https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp.git
cd BlancaPatagoniaHotelApp
git checkout tesis-a-presentar     # la versión reducida

npm run setup     # instala y dice qué falta y cómo resolverlo
cp .env.example .env.local         # y completarlo con las claves de Supabase
npm run dev
```

La aplicación queda disponible en http://localhost:3000. Para confirmar que
enganchó con la base, `GET /api/salud` tiene que responder
`{"estado":"ok","base":"ok"}`.

Los usuarios ya viven en la base: se entra al panel con las credenciales de cada
uno, y las cuentas nuevas las da de alta un administrador desde `/panel/usuarios`.
`npm run seed:usuarios` sirve sólo para una base **recién creada, sin ningún
usuario** (y para la base local de tests).

El paso a paso completo, con los errores más comunes, está en
[`COMO-LEVANTARLO.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/COMO-LEVANTARLO.md).

---

## Comandos

| Acción | Comando |
|---|---|
| Desarrollo | `npm run dev` |
| **Verificación completa** | **`npm run check`** — lint + typecheck + tests + build |
| Tests | `npm test` · uno solo: `npm test -- <patrón>` |
| **Tests completos, sin saltear nada** | **`npm run test:aislado`** — levanta su propia base (puerto 55321), la deja en cero, siembra y corre todo. Necesita Docker |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Recorrido de todas las pantallas | `npm run e2e` (Playwright, con la app corriendo) |
| ¿La base tiene el esquema del repo? | `npm run esquema:comparar` |
| Sembrar usuarios | `npm run seed:usuarios` — ⚠️ en la base local de tests hay que repetirlo después de cada rehecha de la base, que **borra los usuarios de auth** |
| Salud del sistema | `GET /api/salud` — 200 si la base responde, 503 si no |

> **Antes de dar por terminado un cambio, debe ejecutarse `npm run check`.**

---

## ⚠️ Las dos trampas de los tests

Ambas hacen que el sistema parezca verificado cuando no lo está. Conviene leerlas
antes de la primera ejecución.

### 1. `npm test` sale verde con 583 tests salteados

Sin una base local, los 33 archivos que dependen de ella se saltean en vez de
fallar (corrida del 2026-11-10: 1197 pasan, 583 se saltean, 0 fallan), y el
comando termina con código 0. Entre los salteados está el anti-overbooking.

**Debe leerse la salida —cuántos se saltearon—, no el código de salida.**

### 2. Faltan **cuatro** variables, y la clave publicable se olvida

Vitest no lee `.env.local`. `EXIGIR_DB=1` convierte la ausencia de base en un
error, pero mira la conexión de servicio, **no la clave publicable**: sin
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, los cuatro tests del borde público —los que
verifican que `anon` no puede ver el precio neto— **se saltean en silencio**.

La forma segura es `npm run test:aislado`, que lo resuelve solo. A mano, para
correr la suite completa de verdad:

```bash
EXIGIR_DB=1 \
SUPABASE_URL="http://127.0.0.1:54321" \
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_SERVICE_ROLE_KEY="sb_secret_…" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_…" \
npm test
```

Las claves salen de `npx supabase status`. En CI se exportan solas.

Y **nunca contra la base de la nube**: hay 20 archivos de test que borran filas con
`service_role`. `tests/apoyo/db.ts` corta si la URL no es local.

---

## Qué corre en cada push

| Workflow | Qué verifica |
|---|---|
| **CI** | Levanta Postgres con Docker, crea el admin y corre `npm audit`, typecheck, lint, la suite completa con `EXIGIR_DB=1` y el build |
| **E2E** | Recorre las pantallas del panel en un navegador (Playwright) |

Dos cosas del CI que hay que respetar si se lo toca:

1. El paso del seed invoca **`node scripts/seed-usuarios.mjs` directo**, no el
   script de npm (ése usa `--env-file-if-exists`, que no aplica en el runner).
2. **Sin ese paso, la tabla `perfiles` queda vacía** y los tests de facturación
   fallan por la clave foránea de «quién emitió». Fue la causa de que este workflow
   no terminara en verde durante mucho tiempo.

---

## Estructura del repositorio

```
src/app/(front-publico)/  # portal del huésped: reservar, alojamientos, encuesta, pago
src/app/(front-gestion)/  # login y panel (staff, por rol) — 12 áreas
src/app/(back-api)/       # route handlers: webhook de pagos, cron, salud, búsqueda
src/lib/                  # dominio puro, disponibilidad, pagos, divisas, Supabase
supabase/                 # 127 migraciones SQL numeradas + seed
docs/                     # documentación del proyecto y de la tesis
tests/                    # 141 archivos, 1780 tests (Vitest)
```

---

## Deploy

**Pendiente**, porque requiere cuentas del hotel: Vercel para la aplicación y
Supabase cloud para la base.

⚠️ **Variables obligatorias en producción.** Si faltan, el sistema **falla al
arrancar, a propósito** ([ADR 0018](Decisiones-de-arquitectura)):

`EMAIL_PROVIDER` · `FACTURACION_PROVIDER` · `COTIZACION_PROVIDER` ·
`PAGO_PROVIDER`

`PAGO_PROVIDER` es el único que admite **varias separadas por comas**
(`mercadopago,stripe`). Con las pasarelas van además
`MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` y
`STRIPE_WEBHOOK_SECRET`.

Opcionales: `DOLARAPI_URL`, `ARGENTINADATOS_URL`, `AMBITO_URL`. Y `CRON_SECRET`, sin el cual las tres tareas programadas rechazan todo.

La lista completa está en
[`.env.example`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/.env.example).
Hay que revisarlas **antes** del deploy, no después.

---

## Para quien vaya a escribir código

Corresponde leer [`AGENTS.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/AGENTS.md)
—arquitectura, convenciones y trampas— y
[`CLAUDE.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/CLAUDE.md)
—el proceso de trabajo—.

Las tres reglas que más se pasan por alto:

1. **Ningún `{ error }` de Supabase se descarta.** Un `insert` que falla sin avisar
   deja la pantalla recargando sin cambios, y quien la usa no puede distinguir «no
   se pudo» de «no pasó nada». Había 38 casos así; el objetivo es mantenerlo en **cero**.
2. **Toda página y acción del panel verifica el rol** con `requerirAcceso(area)`.
3. **Un bugfix entra con el test que fallaba antes del fix.**
