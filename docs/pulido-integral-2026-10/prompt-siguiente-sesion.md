# Prompt de continuación — Pulido integral 2026-10

> Escrito el 2026-10-07 para que una sesión nueva (de Claude Code o de
> quien lo lea) retome este trabajo sin depender del chat donde se hizo.
> Es un prompt, no un informe: está escrito para dárselo a Claude como
> instrucción de arranque. El brief original sigue en `brief.md` (no se
> toca); esto es el estado real después de ejecutarlo y el paso siguiente.

---

## 0. Contexto que tenés que tener antes de tocar nada

Sos la continuación de una auditoría de "pulido integral" sobre el PMS
Blanca Patagonia. Todo el trabajo vive en la rama local
**`pulido/integral-2026-10`**, creada desde `main` (`cd8e8f7`), con
**24 commits**, todos con `npm run check` en verde en el momento de
commitear. **La rama NO está pusheada**: quien te dé este prompt no tiene
permiso de escritura (`push`) sobre
`blanca-patagonia/BlancaPatagoniaHotelApp` — confirmalo vos también antes
de intentar nada (`gh api repos/blanca-patagonia/BlancaPatagoniaHotelApp
--jq '.permissions'`) en vez de asumir que cambió.

Leé, en este orden, antes de hacer cualquier otra cosa:

1. Este archivo entero.
2. `docs/pulido-integral-2026-10/brief.md` — las instrucciones originales
   completas (las 8 fases) que dieron origen a todo esto.
3. `docs/pulido-integral-2026-10/progreso.md` — el índice vivo, pero
   tratalo como **secundario a este archivo**: éste es más nuevo y más
   completo.
4. Las entradas de `docs/bitacora.md` fechadas 2026-10-06 y 2026-10-07
   (son muchas — buscá por esas fechas, no leas el archivo entero).
5. Los cinco `docs/pulido-integral-2026-10/fase-N-*.md` si necesitás el
   detalle de una fase puntual.

`CLAUDE.md` y `AGENTS.md` siguen valiendo enteros y no quedan anulados por
nada de esto — léelos si no los tenés frescos.

---

## 1. Qué se hizo — fase por fase, con hallazgos concretos

### Fase 0 — Línea de base y plan ✅
Verificados los 7 datos de partida del brief contra el repo real (todos
coincidían). Línea de base sin Docker: lint 0, typecheck 0, build 0,
1733/2294 tests (561 saltean sin base, declarado). **Hallazgo no
buscado**: `npm audit --audit-level=high` dio **1 vulnerabilidad crítica**
(RCE en `next/og ImageResponse`, GHSA-vcvr-r3jv-pc5j, next 16.2.0-16.3.5)
más 7 altas.

### Fase 1 — Ramas y PRs ✅
Las 10 ramas que el brief daba por absorbidas, reconfirmadas por
CONTENIDO (no por SHA — `main` es historia de squashes). Las 10 siguen
siendo "proponer borrar". Rescatado: 26 tests de
`docs/deriva-y-env-incompleto` (cherry-pick limpio) y 7 subagentes +
12 páginas de wiki de `claude/github-repo-improvements-o2o8qz` (con 3
números desactualizados corregidos al copiar). PR #91 revisado:
recomendar merge. **Los 7 PRs de Dependabot, cada uno en worktree
aislado con `npm ci` + check completo**: #94 (react+next, **arregla la
RCE crítica** — prioridad máxima), #55, #58, #56 (mayor, pasó entero)
recomendados mergear; #95/#96 (solo workflows) con el rojo real siendo
rate-limit de Docker Hub, no el cambio — se agregó reintento al CI
(`chore/ci-docker-rate-limit-retry`, incorporado acá); #57 (ESLint 10)
rechazado por tercera vez por `eslint-plugin-react` — se agregó `ignore`
en `.github/dependabot.yml` y se comentó en el PR.

### Fase 2 — Lógica de reservas ✅ (8/8 puntos)
1. Máquina de estados verificada igual al enum de la base; nuevo test de
   contrato (`tests/estado-reserva-sincronizado.test.ts`) que lee las
   migraciones del disco, sin DB.
2. **Atomicidad — las dos mitades:**
   - `saldarSiCorresponde` recorría el camino de estados con un `update`
     por paso; si fallaba el segundo, la reserva quedaba a medias para
     siempre. **Arreglado de verdad**: migración **0109**
     (`avanzar_estado_reserva`), con tests
     (`tests/avanzar-estado-reserva-atomico.test.ts`).
   - `emitirFactura`: se pensó que faltaba resolver (copiado de
     `docs/analisis-pendientes-2026-09-09.md`) y **resultó que NO** — la
     migración 0069 (2026-09-01) ya lo había hecho. Se corrigió la
     documentación en vez de escribir código de más.
3. Cotización sin tarifa: verificado EN EL NAVEGADOR en panel y portal.
4. Choque de cupo: faltaba test para `crearReservaEnUnidadLibre` (el
   único de los tres caminos sensibles al anti-overbooking que no lo
   tenía) — nuevo `tests/crear-reserva-choque.test.ts`.
5. Cancelación (bordes día 14/7): ya estaba cubierto, no hizo falta nada.
6. `reservas.total` nunca se escribe a mano: confirmado y con test de
   contrato (`tests/reservas-total-sin-mano.test.ts`).
7. Checkout del portal de punta a punta: verificado EN EL NAVEGADOR
   (alta → seña → saldo → pagada), confirmando en vivo que el fix del
   punto 2 funciona en el camino real del webhook.
8. Pagos y saldo: repaso de comentarios `⚠️` sin test — el único hueco
   real era `textoDeCancelacion` (nunca tenía NINGÚN test), cerrado con
   `tests/cancelacion-texto.test.ts`.

### Fase 3 — Botones, formularios y acciones ✅ (por grep, no archivo por archivo)
De 81 archivos con `<form action=`, 41 sin `BotonEnvio` directo — de esos,
**3 eran un hueco real** (sin ningún bloqueo contra doble envío): el chat
de conversaciones internas, el cambio de etapa comercial de una agencia,
"marcar atendida" de una consulta. Los tres pasan a `BotonEnvio`. 6
botones visuales sin `type="button"` corregidos (cero riesgo real, pero
es la regla). 10 de 11 acciones destructivas ya tenían `confirmar=` con
el importe explicitado; la única sin confirmar no mueve plata ni es
irreversible, se deja así. Íconos sin `aria-label` y `<a>` en vez de
`Link`: cero en los dos casos.

### Fase 4 — Interfaz gráfica ⏳ (código sí, navegador no)
Sweep completo sin hallazgos nuevos: 69/70 pantallas usan `Pagina` (la
excepción, justificada — comprobante imprimible), cero `sky`/`amber`,
`Mensaje`/toasts con los roles ARIA correctos, cero regresiones de los
bugs de formato de moneda/fecha ya cerrados antes. Se corrigió un
hallazgo FALSO de la Fase 0: las "13 rutas sin `loading.tsx`" no son una
falta — cascada igual que `error.tsx`. **No tocados**: los 5 archivos más
grandes (sin test de componente en el repo, partirlos a ciegas es el
riesgo que el propio criterio del brief pide evitar), responsive real,
contraste medido, Lighthouse.

### Fase 5 — Portal público del huésped ⏳ (código sí, navegador parcial)
Los tres riesgos concretos del brief, verificados por código, cero
hallazgos: ningún dato de otro huésped por URL (las 6 rutas por token
resuelven su fila primero), ningún precio neto expuesto (`precio_rack`
únicamente, `tarifaTipo: 'rack'` hardcodeado, `conIva()` siempre), fotos
de tipos sin tarifa con diseño de respaldo terminado. El checkout de
punta a punta SÍ se verificó en vivo (Fase 2.7). Falta el resto del
recorrido visual (catálogo, encuesta, firmar, asistente del portal).

### Fase 6 — Deuda que se puede pagar hoy ✅
Los 5 issues, cada uno comentado en GitHub con evidencia:
- **#86**: los dos criterios YA estaban resueltos (paginación: los 13
  listados sin `Paginacion` explícita están todos acotados de otra
  forma; tokens: la migración 0063 ya audita cada tipo, y el cabo suelto
  que dejaba anotado —`firmas.token`— ya lo resuelve `motivoNoFirmable()`
  sin que quedara marcado).
- **#70**: comentado con el resumen de todo el recorrido como plan de
  pruebas.
- **#88**: NO se cierra entera (excede una sesión); comentado con lo que
  sí aporta esta rama de cada auditoría.
- **#89** y **#75**: bloqueados, comentado el porqué de cada uno.

---

## 2. Qué falta — en orden de qué tan fácil es resolverlo

### 2.1. Lo más simple: acciones que solo necesitan permiso, no trabajo
- **Mergear PR #94 YA** — arregla la RCE crítica de Next.js. Es lo único
  realmente urgente de todo este trabajo.
- Mergear #55, #58, #56, #95, #96 (verificados en verde, sin motivo para
  esperar).
- Mergear PR #91 (CODEOWNERS/CONTRIBUTING — apunta a usuarios y rutas
  reales).
- Pushear `pulido/integral-2026-10` y abrir el PR en draft contra `main`
  que pide la sección 1 del brief (qué cambió / por qué / cómo probarlo
  — la bitácora de esos dos días es el insumo).
- Borrar las 10 ramas remotas que la Fase 1 reconfirmó absorbidas (lista
  completa en `fase-1-ramas-y-prs.md`).
- Cerrar PR #57 (ESLint 10) o dejarlo — ya tiene el `ignore` en
  `dependabot.yml` para que no se reabra solo.

**Nada de esto lo puede hacer una sesión sin permiso de `push`/`write`.
Si vos SÍ lo tenés, es la primera cosa que hacer, antes que cualquier
fase nueva.**

### 2.2. Si recuperás el navegador (probalo primero: ver §4)
- **Fase 3 "de verdad"**: el recorrido clic-por-clic pantalla por
  pantalla que el brief pedía originalmente — esta pasada lo cubrió por
  grep, que encontró los mismos 3 huecos reales pero no reemplaza mirar
  la pantalla.
- **Fase 4 completa**: responsive en 375/768/1280, contraste AA medido
  (no inferido del nombre de la clase), Lighthouse sobre las 5 pantallas
  más usadas + el portal, orden de tabulación en los formularios de
  reserva.
- **Fase 5 completa**: el recorrido visual de `/alojamientos`,
  `/encuesta/[token]`, `/firmar/[token]` y el asistente del portal (el
  checkout YA está verificado en vivo, no hace falta repetirlo).
- Verificación visual de los 3 cambios de `BotonEnvio` de la Fase 3
  (`conversaciones/chat.tsx`, `agencias/page.tsx`,
  `conversaciones/page.tsx`) — el riesgo es bajo pero no se vieron en
  vivo.

### 2.3. Trabajo real, no bloqueado por nada — si alguien quiere seguir profundizando
- **Issue #88 completo**: auditar las 103+ políticas RLS una por una.
  Es un trabajo de varios días, no de una sesión — necesita Docker (que
  si está disponible) y un plan propio, no un apéndice de esta fase.
- **El resto de la Fase 7** ("que la documentación refleje lo que
  cambiaste"), diferido a propósito por el mensaje 2 del brief original:
  - `COMO-LEVANTARLO.md` tiene la MISMA deriva que tenía `README.md`
    antes de esta pasada: dice "67 migraciones" (son 108), "1555 tests"
    (son 2294+), "27 ADRs" (son 40, numerados; 39 archivos reales —
    el 0034 está retirado, ver `CLAUDE.md`).
  - `AGENTS.md` dice "24 archivos" con `service_role` (hoy son 29, ya
    corregido en `README.md`) y da un TERCER número de tablas/políticas
    RLS distinto al de `CLAUDE.md` (105 sobre 52, contra "más de 103
    sobre 56, y sigue creciendo") — conviene unificar en una sola frase
    que no prometa un número exacto, como se hizo en `release-manager.md`
    al rescatarlo en la Fase 1.
  - `docs/manual-usuario.md` y `docs/manual-tecnico.md`: no se
    auditaron en ningún momento de este pulido.
- **El informe final** (`docs/auditoria-pulido-2026-10.md`, sección 5 del
  brief original): línea de base vs. resultado, tabla de ramas/PRs,
  hallazgos por fase con su commit, qué queda y por qué, qué tiene que
  hacer el usuario. **Si llegaste hasta acá sin ese archivo creado,
  escribilo vos primero** — es el único entregable formal que el brief
  pide y que, a la fecha de este prompt, no existe todavía.
- Un ADR nuevo (el próximo es el **0041**) si corresponde documentar
  `avanzar_estado_reserva` como decisión de arquitectura — el patrón ya
  existe (ADR de `aplicar_precio_reserva`, 0085, aunque esa es migración
  no ADR — revisar si realmente amerita ADR propio o alcanza con el
  comentario de la migración 0109, que ya es extenso).

---

## 3. Qué hay que mejorar — deuda y fricciones encontradas en el camino

- **El entorno de este sandbox tiene el navegador roto para `localhost`**
  desde algún punto de la Fase 3 (sitios externos cargan bien). Se probó
  varias veces con tabs nuevas, `127.0.0.1` y la IP directa, sin éxito.
  Es casi seguro un permiso de sitio de la extensión que se reseteó — no
  es un problema del dev server ni de Docker (ambos respondían 200 por
  `curl` mientras el navegador fallaba). **Antes de asumir que sigue
  roto, probalo vos**: puede haberse arreglado solo entre sesiones.
- **La base local de este sandbox tenía (al empezar la Fase 0) el
  historial de migraciones desincronizado del esquema real** —
  `supabase migration up` se quejaba de que tablas de 0096+ ya existían
  con el historial marcado solo hasta 0101. Se resolvió aplicando la
  migración 0109 directo con `psql`, sin tocar `schema_migrations`. Si
  volvés a ver ese error, no es nuevo: es el mismo problema de origen,
  documentado en `fase-0-linea-de-base.md`.
- **Quedan 6 archivos de test fallando contra la base local de este
  sandbox, sin relación con nada de este pulido**
  (`anon-no-escribe`, `rls-por-rol`, `ari-servicio`, `canal-cargos`,
  `canal-servicio`, `cotizacion` — 14 casos). Confirmado con `git stash`
  en la sesión original que ya fallaban antes de cualquier cambio de esta
  rama. Coinciden con las tablas de canal/channel-manager (migraciones
  0094-0108) que el historial de migraciones no tenía marcadas, más un
  artefacto de ×2,04 en `cotizacion.test.ts`. Probablemente un problema
  de ESTE volumen Docker puntual, no del código — en un `db reset` limpio
  no debería reproducirse (pero recordá: **no corras `db reset` sin
  avisar**, borra los usuarios de auth).
- **Documentación que afirma algo sin haberlo corrido** fue la causa de
  dos de los hallazgos "falsos" más caros de esta pasada (`emitirFactura`
  y `loading.tsx`). Los dos estaban en documentos que otra fase de esta
  MISMA rama había escrito sin correr el test/leer el código que lo
  habría desmentido en el momento. Antes de repetir una afirmación de
  `docs/analisis-pendientes-2026-09-09.md`, `docs/PENDIENTES.md` o
  cualquier nota de `progreso.md`, verificala contra el código si hay
  forma barata de hacerlo — es la lección que `docs/bitacora.md` del
  2026-10-07 deja escrita de punta a punta.
- **El patrón de `botonClases(variante, 'px-N py-N text-xs')` para
  compactar un botón en una tabla depende de que Tailwind resuelva el
  orden de las clases a favor de las últimas** — no hay `!important` de
  por medio. Funciona porque ya se usaba así en el repo
  (`conversaciones/page.tsx` original), pero es frágil: si alguna vez un
  botón compacto se ve con el padding grande de la variante, es la
  primera sospecha.

---

## 4. Cómo arrancar la próxima sesión, paso a paso

1. `git branch --show-current` — confirmá que seguís en
   `pulido/integral-2026-10` (o hacé `git checkout pulido/integral-2026-10`
   si no existe en este working tree, viene del remoto de otra sesión).
2. `gh api repos/blanca-patagonia/BlancaPatagoniaHotelApp --jq
   '.permissions'` — confirmá si ahora hay `push`. Si lo hay, hacé primero
   todo el §2.1 antes de seguir con cualquier fase nueva.
3. Si tenés navegador disponible (probalo con una URL cualquiera de
   `localhost`, no asumas que sigue roto), priorizá el §2.2.
4. Si no hay navegador ni permiso nuevo, el trabajo de más valor que
   queda es el **informe final** (§2.3) — es lo único que falta del
   brief original que no depende de nada externo.
5. Pase lo que pase: `npm run check` en verde antes de cada commit,
   entrada en `docs/bitacora.md`, y actualizar
   `docs/pulido-integral-2026-10/progreso.md` al terminar cada pieza —
   es lo que permitió escribir este mismo prompt sin tener que releer
   24 commits a mano.
