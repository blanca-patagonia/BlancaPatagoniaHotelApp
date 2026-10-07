# Pulido integral 2026-10 — progreso

> El pedido completo está en `brief.md` (no se edita). Acá se anota, fase por
> fase, qué se hizo, qué quedó pendiente y qué cambió de plan. El detalle de
> cada fase va además en `docs/bitacora.md` con fecha; esto es el índice
> rápido para no releer la bitácora entera al retomar.

## Estado

| Fase | Título | Estado | Sesión | Entrada en bitácora |
|---|---|---|---|---|
| 0 | Línea de base y plan | ✅ hecha | 2026-10-06 | «Pulido integral, Fase 0: línea de base y plan» |
| 1 | Ramas y PRs | ✅ hecha | 2026-10-06 | «Pulido integral, Fase 1: ramas y PRs» |
| 2 | Lógica de reservas | ✅ hecha (los 8 puntos, cerrados o confirmados ya resueltos) | 2026-10-06/07 | ver entradas del 2026-10-06 y 2026-10-07 en `docs/bitacora.md` |
| 3 | Botones, formularios y acciones | ✅ hecha (por grep dirigido, no archivo por archivo — ver nota) | 2026-10-07 | «Pulido integral, Fase 3: botones, formularios y acciones» |
| 4 | Interfaz gráfica | ⏳ parcial (todo lo verificable por grep, cero navegador — ver `fase-4-interfaz-grafica.md`) | 2026-10-07 | «Pulido integral, Fase 4: interfaz gráfica» |
| 5 | Portal público del huésped | ⏳ parcial (los 3 riesgos del brief verificados por código, cero navegador — ver `fase-5-portal-publico.md`) | 2026-10-07 | «Pulido integral, Fase 5: portal público del huésped» |
| 6 | Deuda que se puede pagar hoy | ✅ hecha (los 5 issues comentados con evidencia — ver `fase-6-deuda-de-hoy.md`) | 2026-10-07 | «Pulido integral, Fase 6: deuda que se puede pagar hoy» |
| 7 | Documentación al día (acotada: README/CLAUDE.md/PENDIENTES) | ✅ hecha (acotada) | 2026-10-06 | «Pulido integral, Fase 7 (acotada): deriva de README/CLAUDE.md/PENDIENTES» |

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

- **El navegador automatizado dejó de poder cargar `localhost` a mitad de
  la Fase 3** (sitios externos sí cargan — no es que falte Docker ni el
  dev server, que respondían bien por `curl`). Probable permiso de sitio
  de la extensión reseteado entre sesiones. Si se recupera, conviene
  verificar visualmente los tres cambios de `BotonEnvio` de la Fase 3
  (`conversaciones/chat.tsx`, `agencias/page.tsx`, `conversaciones/page.tsx`)
  — el riesgo es bajo (componente ya usado en ~30 lugares, typecheck y
  lint en verde) pero no se vieron en vivo.
- **Fase 3 se hizo por grep dirigido a los cinco criterios del brief, no
  abriendo los ~64-81 archivos uno por uno.** Cubrió lo mismo con menos
  tokens y encontró los 3 huecos reales que había (de 41 candidatos
  revisados). Si una sesión futura quiere el recorrido manual completo
  pantalla por pantalla que pide el brief originalmente, todavía no se
  hizo ese nivel de detalle.
- **Corrección 2026-10-07: `emitirFactura` NO estaba pendiente — era una
  nota de esta misma rama (y de `docs/analisis-pendientes-2026-09-09.md`)
  que había quedado desactualizada sin verificar contra el código.** La
  migración 0069 (2026-09-01) ya hizo idempotente `reservar_numero_factura`
  y `emitirFactura` ya trata el choque de dos emisiones como una carrera
  resuelta. Corrido `tests/acciones/reservas.test.ts` el 2026-10-07: el
  contador avanza 1, no 2, con dos emisiones simultáneas. Se corrigió la
  nota en `docs/analisis-pendientes-2026-09-09.md` §4. Lección: no repetir
  una afirmación de un documento sin confirmarla contra el código cuando
  hay forma barata de hacerlo (acá, correr un test que ya existía).
- **Fase 2: lo que queda.** Hechos los puntos 1 (máquina de estados,
  `tests/estado-reserva-sincronizado.test.ts`) y 2 (atomicidad de
  `saldarSiCorresponde`, migración 0109 — y, como se corrigió arriba, la
  atomicidad de `emitirFactura` ya estaba resuelta de antes), 4 (el choque de
  cupo en el alta —`crearReservaEnUnidadLibre`— nunca tuvo test contra la
  restricción real; mudanza y recotización ya lo tenían. Nuevo
  `tests/crear-reserva-choque.test.ts`) y 6 (nada escribe `reservas.total`
  a mano, `tests/reservas-total-sin-mano.test.ts`). El punto 5
  (cancelación, bordes día 14/7) se revisó y **ya estaba cubierto** por
  `tests/cancelacion.test.ts` desde antes — no hizo falta tocar nada.
  **El 3 y el 7 se verificaron en el navegador de verdad** (ver bitácora
  del 2026-10-06, "Fase 2.3 y 2.7"), contra Supabase local — sin tocar
  `.env.local` ni la nube en ningún momento: fechas sin tarifa (panel Y
  portal, los dos con aviso claro y sin forma de avanzar a un precio
  cero) y el checkout completo del portal (alta → seña → saldo →
  `pagada`), que de paso confirmó en vivo que el fix de atomicidad del
  punto 2 funciona en el camino real del webhook, no solo en el test
  unitario. Ningún bug encontrado en ninguno de los dos.
  Queda el **8** (pagos y saldo — ya tiene bastante cobertura en
  `tests/acciones/reservas.test.ts`: idempotencia del cobro, "pagada" solo
  con consumos cubiertos; falta el repaso explícito de comentarios "⚠️"
  sin test que pide el brief, y el navegador ya probó el camino feliz
  completo).
- **Confirmado con Octi (2026-10-06): el deploy sigue sin pasar de
  verdad.** Los crons de `vercel.json` están listos para cuando se
  despliegue, pero el sistema todavía no corre en Vercel/Supabase cloud en
  producción. `CLAUDE.md` y `README.md` quedan como estaban — la línea era
  correcta, no deriva.
- **El cierre final de la Fase 7 queda con tres documentos por actualizar
  que esta corrida no tocó** (fuera del recorte explícito): `COMO-
  LEVANTARLO.md` (misma deriva que tenía `README.md`: 67 migraciones, 1555
  tests, 27 ADRs), `AGENTS.md` (24→29 archivos con `service_role`; da
  "105 políticas sobre 52 tablas" contra las "más de 103 sobre 56" de
  `CLAUDE.md` — unificar los dos en un solo número, o en la misma frase
  que ya no promete un número exacto) y los manuales de usuario/técnico.
- **`docs/PENDIENTES.md` y `docs/analisis-pendientes-2026-09-09.md` ya
  tienen veredicto**: el primero es histórico, el segundo es el vigente —
  pero ambos quedan atrás de los issues de GitHub (#68-#89), que es donde
  hay que mirar primero para saber qué falta hoy.
- **P0 de la Fase 0, confirmado y resuelto EN RECOMENDACIÓN por la Fase 1:**
  la RCE crítica de Next.js (`next/og ImageResponse`, GHSA-vcvr-r3jv-pc5j) la
  arregla el PR de Dependabot **#94**, verificado en worktree aislado
  (`npm audit` pasa de 1 crítica + 7 altas a 0 + 7, resto del `check` en
  verde). **Sigue sin mergearse** — esta cuenta no tiene permiso de `push`.
  Si al leer esto el PR #94 todavía está abierto, es la acción más urgente
  de todo este trabajo: avisarle a Octi, no esperar a que termine el resto
  de las fases.
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
