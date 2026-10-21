# Fase 1 — Ramas y PRs (2026-10-06)

> Comparación por CONTENIDO (`git diff main origin/<rama>`), no por SHA:
> `main` es historia lineal de squashes y los commits originales de una rama
> vieja nunca van a aparecer como "ya en main" con `git log main..rama`.

## 1. Ramas "ya absorbidas" — reconfirmadas

| Rama | Evidencia | Veredicto |
|---|---|---|
| `audit/fase-1-seguridad-critica` | PR **#9**, `MERGED` 2026-08-14, head = esta rama. `git diff --shortstat main origin/<rama>`: 598 archivos, +4063 / **-102322**. El contenido "propio" que quedaría son versiones viejas que `main` ya rehizo — el caso citado en la bitácora (`[auth.email].enable_signup`) sigue siendo el ejemplo real: con esa línea nadie entra al panel. | **Absorbida. No mergear. Proponer borrar el remoto.** |
| `feat/4-booking-integracion` | PR **#13**, `MERGED` 2026-08-22, head = esta rama. Mismo patrón: -77705 líneas contra main. | **Absorbida. No mergear. Proponer borrar el remoto.** |
| `feat/booking-y-auditoria-rls` | Sin PR propio; la bitácora del 2026-08-25 la da por absorbida en el squash #11. `git diff --shortstat`: 532 archivos, +4687 / -78445. | **Absorbida (según bitácora, reconfirmado por volumen). No mergear.** |
| `historia/detalle-hasta-0057` | Sin PR propio; bitácora la da por absorbida en el squash #14. `git diff --shortstat`: 526 archivos, +4900 / -77705. | **Absorbida. No mergear.** |
| `feat/relevamiento-cliente-agosto` | Sin PR propio. `git diff --shortstat`: 485 archivos, +5043 / -70647. | **Absorbida. No mergear.** |
| `integracion/agosto` | Sin PR propio. `git diff --shortstat`: 477 archivos, +5044 / -69154. | **Absorbida. No mergear.** |
| `fix/panel-nav-y-desbordes` | Caso puntual pedido: trae `app/panel/_components/plegable.tsx` (= `TarjetaPlegable`, tarjetas de Configuración plegables) y `preferencias.ts` (hook de localStorage, cubre el plegado de grupos del menú **y** de las secciones de Configuración). Verificado en `main`: el plegado de grupos del menú está cubierto y en USO real (`shell.tsx:25-26` importa `nav-plegado.ts` y `nav-colapso.ts`, los dos activos). El plegado de **secciones de Configuración** no tiene equivalente directo — pero no hace falta: `main` partió esa pantalla en 7 páginas propias (`app/panel/config/{datos-fiscales,tarifario,ubicaciones,divisas,conexiones,plantillas,inventario}`), que es el patrón que el propio proyecto prefiere (Fase 15: "nada oculto, alta en pantalla propia"). No se perdió funcionalidad; se resolvió mejor. | **Absorbida y mejorada. No mergear.** |
| `feat/5-ical-saliente` | El feed iCal de salida (B7) está en `main` desde el ADR 0022 / migración 0065, con otro nombre de archivo y otra numeración (la bitácora del 2026-08-25 explica por qué: dos `0058` no podían convivir). `git diff --shortstat`: 517 archivos, +4882 / -75383. | **Absorbida bajo otro nombre. No mergear.** |
| `feat/pwa-panel` | PR **#27** (`feat(pwa): el panel se instala como aplicación...`), `MERGED` 2026-08-27, head = esta rama (hay además un PR #28 `CLOSED` con el mismo head, de un intento anterior). | **Absorbida. No mergear.** |
| `feat/pwa-panel-instalable` | PR **#26**, `CLOSED` (no `MERGED`) — el trabajo real de PWA entró por `feat/pwa-panel` (#27). `git diff --shortstat`: 409 archivos, +4305 / -52978. | **Absorbida por otra rama. No mergear.** |

**Las diez quedan igual que las clasificó el brief.** No apareció nada de
valor que no esté ya en `main` por otro camino.

## 2. Rescatado de ramas con valor sin mergear

### `docs/deriva-y-env-incompleto` — commit `35f4e6e`

Un solo commit nuevo sobre lo que ya es PR #53 (mergeado): 26 tests puros
(`tests/busqueda-servicio.test.ts`, `tests/nav-colapso.test.ts`) para código
que entró con el PR #50 sin cobertura. **Cherry-pick limpio**, sin adaptar
una línea, los 26 pasan contra `main` tal cual está hoy. Commit
`fc795ea` en esta rama.

**Veredicto: rescatado y aplicado. Proponer borrar el remoto** (su único
contenido de valor ya está en `pulido/integral-2026-10`).

### `claude/github-repo-improvements-o2o8qz`

- **7 agentes nuevos** (`accesibilidad`, `continuidad`, `docs-sync`, `i18n`,
  `privacidad`, `release-manager`, `sre-observabilidad`) + su `README.md`.
  Ninguno se superpone con los 4 que ya tiene `main`. Traídos tal cual,
  salvo dos números desactualizados **en la rama de origen** que se
  corrigieron al copiar (`release-manager.md`: "67 migraciones" / "1555
  tests" → se reescribió para no hardcodear números que se desactualizan,
  con la instrucción explícita de contarlos ejecutando).
- **12 páginas de `docs/wiki/`**. Contenido arquitectónico vigente (los ADRs
  que cita siguen siendo los mismos), pero con el mismo problema de números
  viejos **de cuando se escribió esa rama** (hace más de un mes de historia
  del proyecto): "67 migraciones" (hoy 108), "1555 tests" (hoy 2294 en 146
  archivos), "24 archivos `actions.ts`" (hoy 33). Se corrigieron los tres al
  copiar. **"43 tablas" se sacó en vez de corregirse**: no se pudo contar
  con certeza sin Docker en esta corrida (`create table` + tablas
  eliminadas en migraciones posteriores no da un número confiable por
  grep), así que se prefirió no inventar uno — queda "no verificado" para
  quien tenga base local.
- **Descartado a propósito**: `.github/ISSUE_TEMPLATE/` y el `CODEOWNERS` de
  esa rama. Las plantillas de issues/PR ya las trajo el PR #90 (mergeado);
  ese `CODEOWNERS` es distinto del que trae el PR #91 (ver §3) y adoptar los
  dos sería commitear dos versiones del mismo archivo.

Commit `95d497c` en esta rama.

**Veredicto: rescatado y aplicado (parcial, a propósito). Proponer borrar el
remoto.**

## 3. PR #91 — `docs/contributing-conducta-codeowners`

Agrega `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` y `.github/CODEOWNERS`.

- **CI verde**, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`.
- El `CODEOWNERS` apunta a `@octi35` y `@santimoran19` — las dos cuentas
  reales de GitHub de Octavio Fakiani y Santiago Morán (verificado:
  `gh api users/octi35` y `users/santimoran19` resuelven, ninguna es
  inventada), y a rutas reales del repo (`/supabase/`, `/.github/`,
  `/SECURITY.md`, `/docs/decisiones/` — las cuatro existen).
- `CONTRIBUTING.md` describe el flujo real de este repo (rama desde `main`,
  prefijos de commit en español, `npm run typecheck/lint/test`, ADRs,
  bitácora, `.env.local` nunca se commitea) — nada inventado, nada que
  contradiga `AGENTS.md`.
- `SECURITY.md`, que `CODEOWNERS` y `CONTRIBUTING.md` referencian, **ya
  existe en `main`** (no es un link roto).

**Veredicto: recomendar merge.** Es el único de esta fase que no tiene
ningún motivo para esperar.

## 4. Dependabot — uno por uno, cada uno en su propio worktree con `npm ci` + `check` completo (sin Docker)

| PR | Qué | lint | typecheck | tests | build | `npm audit` | Veredicto |
|---|---|---|---|---|---|---|---|
| **#94** | react-y-next, 6 paquetes (`next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `eslint-config-next`) | 0 | 0 | 1733/2294 (igual que la base) | OK | **arregla la RCE crítica de next/og** (de 1 crítica + 7 altas → 0 críticas + 7 altas) | **Mergear primero, es el fix de seguridad** |
| **#55** | `zod` 4.5.1 → 4.6.5 | 0 | 0 | 1733/2294 | OK | sin cambios | **Mergear** |
| **#58** | `supabase` CLI (dev) 2.116.0 → 2.117.0 | 0 | 0 | 1733/2294 | OK | sin cambios | **Mergear** |
| **#56** | `vitest` 4.1.11 → 5.0.1 (mayor) | 0 | 0 | 1733/2294, mismos archivos | OK | sin cambios | **Mergear** — pasó entero a pesar de ser mayor |
| **#95** | `actions/labeler` 5→7 (solo workflow) | — | — | — | — | — | **Mergear.** El rojo que tenía era `toomanyrequests` de Docker Hub al bajar las imágenes de Supabase en CI, **sin relación con el cambio** — ver `chore/ci-docker-rate-limit-retry` (cherry-pick `61570b8` en esta rama), que agrega reintentos |
| **#96** | `actions/github-script` 7→9 (solo workflow) | — | — | — | — | — | **Mergear**, mismo motivo que #95 |
| **#57** | `eslint` 9.39.4 → 10.11.0 (mayor) | **falla**: `TypeError: contextOrFilename.getFilename is not a function` en `eslint-plugin-react` (llega vía `eslint-config-next`, que todavía no declara soporte para ESLint 10) | — | — | — | — | **No mergear.** Tercera vez que se propone y rompe igual (#20, #34, #57). Se agregó el `ignore` en `.github/dependabot.yml` (commit `4c525f8`) para que no se reabra solo cada semana sin que cambie nada aguas arriba |

**No se agrupó nada**: cada PR se evaluó solo, como pedía el brief — un
`check` rojo de uno no tiñe el veredicto de los demás (de hecho **ninguno**
de los que pasan arrastra al que falla).

## 5. Tabla resumen

| Rama / PR | Veredicto |
|---|---|
| `audit/fase-1-seguridad-critica` | Absorbida → **proponer borrar** |
| `feat/4-booking-integracion` | Absorbida → **proponer borrar** |
| `feat/booking-y-auditoria-rls` | Absorbida → **proponer borrar** |
| `historia/detalle-hasta-0057` | Absorbida → **proponer borrar** |
| `feat/relevamiento-cliente-agosto` | Absorbida → **proponer borrar** |
| `integracion/agosto` | Absorbida → **proponer borrar** |
| `fix/panel-nav-y-desbordes` | Absorbida y mejorada → **proponer borrar** |
| `feat/5-ical-saliente` | Absorbida bajo otro nombre → **proponer borrar** |
| `feat/pwa-panel` | Absorbida (ya tiene PR mergeado) → **proponer borrar** |
| `feat/pwa-panel-instalable` | Absorbida por otra rama (PR cerrado) → **proponer borrar** |
| `docs/deriva-y-env-incompleto` | Rescatada y aplicada acá → **proponer borrar** |
| `claude/github-repo-improvements-o2o8qz` | Rescatada (parcial) y aplicada acá → **proponer borrar** |
| PR #91 | **Recomendar merge** |
| PR #94 | **Recomendar merge — es el fix de la RCE crítica, prioridad máxima** |
| PR #55 | **Recomendar merge** |
| PR #58 | **Recomendar merge** |
| PR #56 | **Recomendar merge** |
| PR #95 | **Recomendar merge** (el rojo es flakiness de Docker Hub, no del cambio) |
| PR #96 | **Recomendar merge** (idem) |
| PR #57 | **No mergear.** Dejado con `ignore` en Dependabot y comentario en el PR explicando por qué (de la sesión anterior) |

Ninguna de estas acciones (borrar rama remota, mergear PR) se ejecutó: el
brief las reserva para el OK de Octi, y además esta cuenta de GitHub no
tiene permiso de `push` sobre el repo (verificado:
`gh api repos/.../collaborators` → 403, y un intento real de `git push`
devuelve "Permission ... denied").
