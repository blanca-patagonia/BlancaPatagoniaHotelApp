<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# AGENTS.md — Blanca Patagonia

> Operativo: comandos, arquitectura, convenciones y Definition of Done.
> El **proceso** de trabajo (fases, bitácora, ADRs) vive en `CLAUDE.md`. Leé los dos.
> Procedimientos paso a paso: `.claude/skills/`.

## Qué es este proyecto

PMS (sistema de gestión hotelera) del Hotel Blanca Patagonia, El Calafate. Proyecto de tesis.
Dos vistas separadas: **panel interno** de staff por rol (`app/panel`) y **portal público** de
reservas (`app/reservar`, `app/alojamientos`). El flujo central es reserva → estadía → consumos
→ pago → factura, con anti-overbooking garantizado por la base, no por la app.

## Setup y comandos

| Acción | Comando | Estado |
|---|---|---|
| Puesta en marcha | `npm run setup` | verificado — dice qué falta y cómo resolverlo |
| Dev | `npm run dev` | — |
| **Verificación completa** | **`npm run check`** (lint + typecheck + tests + build) | verificado, exit 0 |
| Lint | `npm run lint` | verificado, exit 0 |
| Typecheck | `npm run typecheck` | verificado, exit 0 |
| Tests | `npm test` — uno solo: `npm test -- <patrón>` | verificado, 393 pasan / 43 saltean |
| Build | `npm run build` | verificado, 21 s |
| Sembrar usuarios | `npm run seed:usuarios` | requiere Node ≥ 20.12 |
| Base local | `npx supabase start` · `npx supabase db reset` | necesita Docker |
| Salud del sistema | `GET /api/salud` | 200 si la base responde, 503 si no |

**Antes de decir que terminaste, corré `npm run check`. Sin excepciones.**

## Arquitectura en 20 líneas

```
app/rutas ──124──> app/panel/_components (UI compartida)
          ──100──> lib/domain          (reglas puras)
          ───89──> lib/{auth,pricing,payments,email,firma,facturacion,availability}
          ───60──> lib/supabase        ← puentea la capa de datos (deuda conocida)
lib/servicios ──> lib/domain ──> lib/fechas
lib/supabase ──> Postgres + RLS (~60 políticas sobre 33 tablas)
```

Reglas de dependencia, verificables con `rg`:

- **`lib/domain/` es puro.** No importa `@supabase/*`, `next/*`, `react` ni `zod`. Son 28 módulos de
  reglas testeables sin base. **Nunca** metas un cliente de datos ahí.
- **`lib/` nunca importa de `app/`.** Cero excepciones (hoy hay cero aristas).
- La lógica de negocio va en `lib/domain/`. Las páginas y acciones orquestan; no calculan reglas.
- `lib/supabase/admin.ts` usa `service_role` y saltea RLS: **solo servidor**, nunca con datos del
  usuario sin filtrar.

## Convenciones de código

| Tema | Regla | Referencia canónica |
|---|---|---|
| Idioma | Código y docs en **español** (identificadores incluidos) | `lib/domain/cancelacion.ts` |
| Autorización | `requerirAcceso(area)` en toda página y acción del panel | `lib/auth/session.ts:50` |
| Escrituras que cortan | `cortarSiFalla(error, destino, motivo)` | `lib/acciones.ts:43` |
| Escrituras accesorias | `registrarFalla(error, contexto)` — loguea, no corta | `lib/acciones.ts:71` |
| Server Action con estado | `(prev, formData) => Promise<EstadoX>` con `{ error }` / `{ ok }` | `app/panel/huespedes/actions.ts:67` |
| Después de escribir | `revalidatePath(...)`; no redirigir en silencio | `app/panel/huespedes/actions.ts:92` |
| UI | Componentes de `app/panel/_components/ui.tsx` y `boton-envio.tsx` | `app/panel/proveedores/page.tsx` |
| Tests | `describe`/`it` en español, sin mocks en dominio | `tests/cancelacion.test.ts` |

**Nunca revises `{ data }` sin revisar `{ error }`.** Es el bug clásico de este stack y `lib/acciones.ts`
existe precisamente para eso.

## Cómo se agrega algo nuevo

Cada receta está en un skill. Invocalos: `add-feature`, `api-endpoint`, `ui-component`,
`db-migration`, `write-tests`.

Regla corta de módulo del panel: `page.tsx` (listado) · `nuevo/page.tsx` · `[id]/page.tsx` ·
`[id]/editar/page.tsx` · `actions.ts` · `loading.tsx` · test en `tests/`.

## Testing

- Dominio puro en `tests/*.test.ts`, sin base ni mocks. Server Actions en `tests/acciones/`.
- Los que tocan Postgres van bajo `describe.skipIf(!hayDB)` (`tests/db.ts`).
- **Trampa:** `npm test` sale verde con **43 tests salteados** si no hay base local — entre ellos
  el anti-overbooking. En CI `EXIGIR_DB=1` los vuelve obligatorios (`tests/db.ts:22`).
- Todo bugfix entra con un test que fallaba antes del fix.

## Definition of Done

- [ ] `npm run check` en verde
- [ ] Test que cubre el cambio (y que fallaba antes, si es bugfix)
- [ ] Toda página y acción nueva verifica rol con `requerirAcceso`
- [ ] Todo `{ error }` de Supabase revisado, no descartado
- [ ] Estados de loading / vacío / error cubiertos si tocaste UI
- [ ] Sin `console.log` de depuración, sin `TODO` sin issue, sin código comentado
- [ ] Sin secretos ni datos hardcodeados
- [ ] `docs/bitacora.md` actualizada; ADR nuevo si hubo decisión de arquitectura

## Reglas duras (NUNCA)

- No commitees `.env.local` ni ningún secreto.
- No edites el bloque entre `BEGIN:nextjs-agent-rules` y `END:nextjs-agent-rules`: lo genera Next.
- No edites una migración ya aplicada. Creá la siguiente con el número que sigue.
- No hagas `git push --force` ni trabajes directo sobre `main`.
- No corras `npx supabase db reset` sin avisar: **borra los usuarios de auth**.
- No hagas `cotizar_estadia` `security definer`: ahí `current_user` pasa a ser el dueño de la
  función y la guarda del precio neto queda siempre en verdadero (ADR 0016).
- No borres ni saltees tests para que pase el build.
- No desactives reglas del linter para "arreglar" un error: arreglá el código.
- No agregues dependencias sin avisar.
- No uses `any`, `as any` ni `@ts-ignore` sin un comentario que lo justifique.
- Commit y push **solo** cuando el usuario lo pida (`CLAUDE.md`).

## Trampas conocidas

- **Next 16:** `cookies()` y `headers()` son `async`; `params` y `searchParams` son `Promise`;
  `middleware` se llama `proxy.ts`. Leé `node_modules/next/dist/docs/` antes de tocar APIs de Next.
- **`next typegen`** genera tipos de rutas: `npm run typecheck` los regenera, no los edites.
- **CI:** el seed invoca `node scripts/seed-usuarios.mjs` **directo**, no `npm run seed:usuarios`
  (ese usa `--env-file-if-exists`, que no aplica en el runner). Sin ese paso `perfiles` queda vacía
  y los tests de facturación fallan por la FK.
- **Rol hardcodeado:** hay 19 lugares con el literal `['admin','gerencia']` en vez de
  `lib/domain/permisos.ts`. Al tocar uno, migralo.
- **`lib/env.ts`** dice que falla "al arrancar", pero `envPublico()`/`envServidor()` son perezosas y
  no validan `MERCADOPAGO_*`, `STRIPE_*` ni `RESEND_API_KEY`.
- **PostgREST corta en 1000 filas** (`max_rows`, `supabase/config.toml:10`), sin error y sin aviso.
  Toda lectura que agregue sobre una tabla entera tiene que ir por `traerTodo` (`lib/paginado.ts`).
- **Los simuladores fallan fuerte en producción:** `EMAIL_PROVIDER`, `FIRMA_PROVIDER` y
  `FACTURACION_PROVIDER` son obligatorias ahí (`lib/integraciones/seleccion.ts`, ADR 0018).

## Automatizaciones (hooks activos)

Configurados en `.claude/settings.json`, documentados en `.claude/hooks/README.md`:

| Evento | Qué hace |
|---|---|
| `PreToolUse` Write/Edit | Bloquea escrituras sobre `.env*`, lockfiles, autogenerados y migraciones ya aplicadas |
| `PreToolUse` Write/Edit | Bloquea contenido con secretos hardcodeados |
| `PreToolUse` Bash | Bloquea `rm -rf`, `push --force`, `db reset`, `reset --hard` |
| `PostToolUse` Write/Edit | Corre `eslint --fix` sobre el archivo tocado |
| `Stop` | Corre los tests y avisa cuántos se saltearon |
| `SessionStart` | Muestra rama, estado de git y migración más reciente |
