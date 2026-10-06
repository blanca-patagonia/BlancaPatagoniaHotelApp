# Fase 0 — Línea de base y plan (2026-10-06)

> Corrida sin navegador y sin Docker, según el mensaje 2 del brief
> (`brief.md`). Los tests de integración saltean a propósito; se cuentan
> cuántos. La verificación visual, la auditoría de reservas y el resto de
> las fases 2-6 quedan para una sesión posterior sobre esta misma rama.

## 1. Datos de partida — verificados, no asumidos

| Dato que afirmaba el brief | Verificado | Cómo |
|---|---|---|
| `main` en `cd8e8f7` | ✅ coincide | `git log --oneline -1 main` |
| CI verde del 24/9 | ✅ verde (y sigue verde el 1/10 y 5/10, todas Dependabot Updates) | `gh run list --branch main` |
| 146 archivos de test | ✅ exacto | `find tests -name "*.test.ts" \| wc -l` → 146 |
| 108 migraciones, próxima 0109 | ✅ exacto | `ls supabase/migrations/*.sql \| wc -l` → 108, último archivo `0108_...` |
| Último ADR 0040, próximo 0041 | ✅ exacto | `ls docs/decisiones/` → `0040-inventario-fisico-real-de-unidades.md` es el más alto |
| `vitest` en `environment: 'node'` | ✅ exacto | `vitest.config.ts:6` |
| Cero tests de componente/E2E | ✅ confirmado | sin matches de `render(`, `@testing-library`, `playwright` en `tests/` |

⚠️ **El slot de migración 0109 ya está tomado**, fuera de esta rama: ver
`progreso.md`. No afecta a las fases 0/1/7 de esta corrida, pero quien haga
la Fase 2 necesita saberlo antes de numerar su propia migración.

## 2. `npm run check`, sin Docker

| Paso | Resultado |
|---|---|
| `npm run lint` | 0 problemas |
| `npm run typecheck` | 0 errores |
| `npm audit --audit-level=high` | **8 vulnerabilidades: 7 altas + 1 crítica** (ver §3, es el P0 de esta línea de base) |
| `npm test` (sin `EXIGIR_DB`, sin Docker) | **113 archivos pasan / 33 saltean (146)** · **1733 tests pasan / 561 saltean (2294)** · 0 fallan |
| `npm run build` | compila sin errores, todas las rutas listadas |

Los 561 tests salteados son exactamente los de integración contra Postgres
(anti-overbooking, cotización por RPC, RLS por rol, etc.) — esperado sin
Docker en esta corrida, tal como pide el brief. **No es un "verde" en el
sentido que exige `AGENTS.md`** (`EXIGIR_DB=1` en CI los vuelve
obligatorios); es la línea de base *de esta corrida puntual*, declarada como
tal.

`COMO-LEVANTARLO.md` dice «1555 tests en verde, cero salteados» con base
local — ya desactualizado (hoy son 2294 tests, 146 archivos). Se marca como
hallazgo de deriva para la Fase 7 completa (fuera del recorte de esta
corrida, que solo toca README/CLAUDE.md/PENDIENTES).

## 3. P0 encontrado al tomar la línea de base: vulnerabilidad crítica vigente

`npm audit --audit-level=high` en `main` (sin tocar nada) da:

```
next  16.2.0 - 16.3.5   CRÍTICA  — RCE en next/og ImageResponse
                         GHSA-vcvr-r3jv-pc5j, arreglada en next@16.3.6+
                         (latest estable hoy: 16.3.8). fixAvailable: true.
source-map-js  1.0.0 - 1.2.1   ALTA   — DoS por offsets de sourcemap. fixAvailable: true.
brace-expansion  <=1.1.20 || 4.0.0-5.0.11   ALTA   — fixAvailable: true.
@next/eslint-plugin-next, eslint-config-next, braces, fast-glob, micromatch
  ALTAS, encadenadas a eslint-config-next@16 — npm sugiere bajar a
  eslint-config-next@14.2.35 (sería downgrade mayor; sospechoso, a revisar
  en Fase 1 junto con el PR #56/#57 de Dependabot, no forzar acá).
```

`package.json` declara `"next": "^16.3.5"` — el caret permite subir hasta
`<17`, así que el fix (16.3.6+) **entra en el rango ya declarado**: no hace
falta tocar `package.json` ni "agregar una dependencia", alcanza con que el
lockfile resuelva a una versión más nueva. Esto se decide en la **Fase 1**,
no acá: el PR de Dependabot **#94** ("react-y-next", 6 paquetes) es
candidato directo a resolverlo — se verifica en esa fase antes de recomendar
nada.

**No se corrió `npm audit fix` en esta rama.** Tocar el lockfile por fuera
del proceso de Dependabot que el brief ya definió (una rama por PR, `check`
completo, sin agrupar) se presta a mezclar esto con cambios no relacionados.
Queda resuelto en la Fase 1, con evidencia.

## 4. Inventario de pantallas

80 rutas con `page.tsx` bajo `app/panel/**`, `app/reservar/**`,
`app/alojamientos`, `app/portal`, `app/encuesta`, `app/firmar` (excluyendo
`_components`). Tabla completa generada por script, no a mano:

- **`loading.tsx`**: 67 de 80 lo tienen. Las 13 que no:
  `app/panel/ayuda`, `app/panel/config/{datos-fiscales,tarifario,ubicaciones,
  divisas,conexiones,plantillas,inventario}`, `app/panel/cierre-diario`,
  `app/panel/reservas/[id]/factura`, `app/panel/canales/externos`,
  `app/reservar/pagar/[token]`, `app/reservar/factura/[token]`.
  Queda para la Fase 4 (estados de carga), que es donde el brief la pone —
  acá solo se deja listada.
- **`error.tsx`**: solo existen `app/error.tsx` y `app/panel/error.tsx`. Eso
  **no es una falta** — en Next.js un `error.tsx` de segmento cubre en
  cascada todas las rutas anidadas que no declaren el propio—; está bien
  así y no entra como hallazgo.
- **`actions.ts`**: 30 archivos bajo esas rutas. Contra eso, 7 archivos
  dedicados en `tests/acciones/` (hay Server Actions probadas también desde
  otros archivos de `tests/`, así que 30 vs 7 no es "23 sin ningún test" —
  es una cota inferior). La cobertura real por acción se mide en la Fase 3,
  no acá.
- Los cinco archivos más grandes que cita el brief se verificaron línea por
  línea y coinciden exactos: `app/panel/canales/page.tsx` 2448,
  `app/panel/reservas/actions.ts` 1901, `app/panel/reservas/[id]/page.tsx`
  1646, `app/panel/canales/actions.ts` 1134, `app/panel/ocupacion/page.tsx`
  1004.

## 5. Plan priorizado para lo que sigue (fases 2-6, otra sesión)

No se ejecuta nada de esto en esta corrida — es el plan que pide la Fase 0,
para que la próxima sesión no arranque de cero.

**P0 — rompe algo:**
1. La vulnerabilidad crítica de Next.js (§3). Se resuelve en la Fase 1 de
   esta misma corrida, más abajo.

**P1 — engaña al usuario o deja datos a medias:**
1. *(Ya resuelto, en rama separada sin integrar)* `saldarSiCorresponde`
   recorría el camino de estados con un `update` por paso; si fallaba el
   segundo, la reserva quedaba a medias para siempre. Ver
   `progreso.md` — rama `fix/avanzar-estado-reserva-atomico`, migración
   0109, con tests. Candidato a traer en la Fase 2.
2. `emitirFactura` no es transaccional: un `PENDIENTES.md` abierto desde
   agosto (carrera de numeración correlativa, riesgo fiscal ADR 0015). El
   test de concurrencia existe pero no afirma ausencia de salto. Fase 2.
3. Falta confirmar si las 13 rutas sin `loading.tsx` (§4) dejan a la persona
   mirando una pantalla en blanco mientras carga, o si hay un loading padre
   que las cubre — no verificado en el navegador en esta corrida (sin
   navegador, por brief). Fase 4.
4. 30 `actions.ts` contra 7 archivos dedicados de test (§4): cuantificar la
   cobertura real, no solo el conteo de archivos. Fase 3/6.

**P2 — pulido:**
1. Los cinco archivos grandes (§4), con el criterio ya fijado por el brief
   (partir solo si ningún test existente se toca). Fase 4.
2. Deriva de documentación: `README.md`, `CLAUDE.md`, `COMO-LEVANTARLO.md`,
   `docs/PENDIENTES.md` vs `docs/analisis-pendientes-2026-09-09.md`. Parte
   se corrige en la Fase 7 de esta misma corrida (README/CLAUDE.md/
   PENDIENTES); `COMO-LEVANTARLO.md` y el resto de "que reflejen lo que
   cambiaste" quedan para el cierre final, como pide el mensaje 2.
3. Ramas remotas sin valor que limpiar — se resuelve (como propuesta, no
   como borrado) en la Fase 1 de esta corrida.
