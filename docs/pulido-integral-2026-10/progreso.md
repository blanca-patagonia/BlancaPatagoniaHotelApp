# Pulido integral 2026-10 — progreso

> El pedido completo está en `brief.md` (no se edita). Acá se anota, fase por
> fase, qué se hizo, qué quedó pendiente y qué cambió de plan. El detalle de
> cada fase va además en `docs/bitacora.md` con fecha; esto es el índice
> rápido para no releer la bitácora entera al retomar.

## Estado

| Fase | Título | Estado | Sesión | Entrada en bitácora |
|---|---|---|---|---|
| 0 | Línea de base y plan | ✅ hecha | 2026-10-06 | «Pulido integral, Fase 0: línea de base y plan» |
| 1 | Ramas y PRs | ⏳ en curso | 2026-10-06 | — |
| 2 | Lógica de reservas | **fuera de esta corrida** | — | — |
| 3 | Botones, formularios y acciones | **fuera de esta corrida** | — | — |
| 4 | Interfaz gráfica | **fuera de esta corrida** | — | — |
| 5 | Portal público del huésped | **fuera de esta corrida** | — | — |
| 6 | Deuda que se puede pagar hoy | **fuera de esta corrida** | — | — |
| 7 | Documentación al día (acotada: README/CLAUDE.md/PENDIENTES) | pendiente | — | — |

## Reglas de esta corrida (mensaje 2 de Octi)

- Solo fases 0, 1 y 7. Las 2-6 las hace otra sesión, sobre esta misma rama.
- Sin navegador y sin Docker. Tests con los que saltean; reportar cuántos.
- Salida de comandos largos truncada.
- De la bitácora, solo las dos entradas que pide la sección 0 (no el archivo
  entero).
- Fase 7 acotada a corregir la deriva de README/CLAUDE.md/PENDIENTES; "que
  reflejen lo que cambiaste" queda para el cierre final.
- Una fase por sesión, con su entrada de bitácora al terminar.

## Cosas que la próxima sesión necesita saber

- **P0 de la Fase 0: `npm audit --audit-level=high` da 1 crítica (RCE en
  `next/og ImageResponse`, GHSA-vcvr-r3jv-pc5j) + 7 altas, sobre `main` tal
  cual está.** Se decide en la Fase 1 (candidato: PR de Dependabot #94).
  Detalle en `fase-0-linea-de-base.md` §3. Si al leer esto la Fase 1 todavía
  dice "⏳ en curso" o "pendiente" en la tabla de arriba, la vulnerabilidad
  sigue sin resolver — priorizarla antes que cualquier otra cosa.
- **El slot de migración 0109 YA ESTÁ TOMADO**, fuera de esta rama: una
  sesión anterior (misma ventana de trabajo, previa a este brief) escribió
  `supabase/migrations/0109_avanzar_estado_reserva_atomico.sql` en la rama
  `fix/avanzar-estado-reserva-atomico` (no mergeada, no en `main`), más
  `lib/reservas/saldar.ts` actualizado para usarla y
  `tests/avanzar-estado-reserva-atomico.test.ts`. Resuelve exactamente lo que
  pide la Fase 2, punto 2 (atomicidad del camino de estados,
  `saldarSiCorresponde`), ya con tests de integración verificados contra una
  base local. **Quien haga la Fase 2 tiene que decidir:** traer esa rama a
  ésta (y entonces la próxima migración libre es la 0110), o ignorarla y usar
  la 0109 para otra cosa (en cuyo caso ese trabajo se pierde). No se mezcló
  solo en esta rama porque el brief es explícito en que la Fase 2 no se toca
  en esta corrida.
- También existe, de la misma sesión previa, `chore/ci-docker-rate-limit-retry`
  (no mergeada): reintento de `supabase start` en CI ante el rate-limit de
  Docker Hub que hacía fallar los PRs #95/#96 por una causa ajena al cambio.
  Se evalúa en la Fase 1 (abajo).
- Ninguna de las dos ramas anteriores se pusheó: este entorno no tiene
  permiso de `push` sobre el repo (confirmado con la API de GitHub,
  `permissions.push: false` para la cuenta autenticada).
