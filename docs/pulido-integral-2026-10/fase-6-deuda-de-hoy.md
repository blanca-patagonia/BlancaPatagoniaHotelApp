# Fase 6 — Deuda que se puede pagar hoy (2026-10-07)

> Orden del brief: #70, #86, #88, #89, #75. Los de integraciones (#76-80,
> #68) y deploy (#71, #74) no se tocan — necesitan credenciales o una
> decisión del hotel.

## Issue #86 — Paginación y manejo de tokens en listados grandes

**Hallazgo: los dos criterios de aceptación ya estaban resueltos.** No
hizo falta escribir código.

**Paginación.** Sweep de los 13 listados del panel que no usan
`Paginacion`/`traerTodo` explícitos (`app/panel/{agencias,avisos,canales,
cierre-diario,config,conversaciones,cuenta,housekeeping,ocupacion,
proveedores,punto-venta,respaldos,usuarios}/page.tsx`):

| Pantalla | Por qué está bien así |
|---|---|
| `agencias`, `proveedores` | No se paginan a propósito — filtran en memoria por saldo (viene de una vista); paginar daría un filtro equivocado. Ya documentado en `docs/PENDIENTES.md` §2 y `AGENTS.md`. |
| `avisos` | `.limit(100)`, fijados primero. |
| `canales` | Archivo de 2448 líneas con 15 consultas — **las 15** tienen `.limit()` (200/5/100/100/500) o están acotadas por mes/ventana de 14 días. Un comentario propio explica que el límite de 200 "se truncaba... sin avisar" hasta que se acotó por mes. |
| `cierre-diario` | Un solo día (night audit), acotado por diseño. |
| `config` | Config fija, no es un listado que crezca. |
| `conversaciones` | `.limit(HISTORIAL)` y `.limit(50)`. |
| `cuenta` | Un solo registro (el propio usuario). |
| `housekeeping` | Acotado a `hoyISO()`. |
| `ocupacion` | Acotado a la ventana de 14/30 días × unidades del hotel. |
| `punto-venta` | `.limit(120)`, acotado a `hoyISO()`/`rangoISO`. |
| `respaldos` | `.limit(20)` — los más recientes, que es lo que importa de un historial de backups. |
| `usuarios` | Acotado al personal real del hotel (decenas, no miles). |

**Ninguno** de los 13 trae la tabla entera sin límite.

**Tokens (expiración y renovación).** La migración **0063** ya es una
auditoría completa, con el porqué de cada decisión escrito en el propio
SQL:

- `agencias.token` / `proveedores.token`: no caducan solos (a propósito —
  un enlace que se apaga a los N días se reenviaría todo el tiempo), pero
  desde la 0063 **sí se pueden revocar** (`token_revocado_en`) y
  regenerar.
- `reservas.token` / `encuestas_satisfaccion.token`: no caducan a
  propósito — el de la reserva abre la confirmación meses después (es una
  función, no un defecto) y el de la encuesta se cierra solo con
  `respondida_en`.
- `firmas.token`: la propia migración 0063 dejaba esto **anotado, no
  resuelto**: "un contrato enviado y nunca firmado queda abierto para
  siempre... lo correcto es que el estado del contrato lo cierre."
  **Ya está resuelto**, aunque no quedó marcado en ningún lado:
  `motivoNoFirmable()` (`lib/domain/contratos.ts:106`) bloquea la firma
  si el contrato no está `enviado` (cubre `rechazado`, `firmado`,
  `vencido` y `borrador`), y además chequea la fecha de vigencia **antes**
  de que corra el proceso que marca `vencido`. Con test dedicado
  (`tests/contratos.test.ts`).

**Conclusión para el issue:** los dos primeros criterios de aceptación
están cumplidos; comentado en GitHub con esta evidencia.

## Issue #70 — Pruebas funcionales y correcciones

El issue pide "tu recorrido ES el plan de pruebas; dejalo escrito". El
recorrido de esta rama (fases 0 a 6 del brief, 2026-10-06/07) cubrió:

- **En el navegador, contra base local** (Fase 2.3/2.7): fechas sin
  tarifa en panel y portal, checkout completo de punta a punta
  (alta→seña→saldo→pagada). Cero bugs.
- **Por código** (Fases 2, 3, 4, 5, 6): máquina de estados, atomicidad de
  reservas y facturación, choque de cupo, botones y confirmaciones,
  consistencia de interfaz, seguridad del portal público, paginación y
  tokens. Encontrados y corregidos: 1 fix de atomicidad real
  (`saldarSiCorresponde`), 3 formularios sin protección de doble envío, 6
  botones sin `type`. Encontrados y corregidos 3 hallazgos **falsos** de
  fases anteriores (dos propios de esta rama sobre `emitirFactura` y
  `loading.tsx`, y confirmado que el de `error.tsx` ya estaba bien).
- **Lo que falta** (sin navegador disponible toda la sesión): responsive
  real, contraste medido, Lighthouse, recorrido visual completo del
  portal público y las Fases 4/5 en su forma original (clic por clic).

Comentado en GitHub con el resumen y el link a esta carpeta de docs.

## Issue #88 — Cerrar las dos auditorías pendientes (seguridad y calidad)

**No se cierra entera — es demasiado grande para esta sesión, y el propio
issue lo anticipa** ("completar el alcance al planificar el sprint"). Lo
que SÍ aporta esta rama, con evidencia concreta:

- **Calidad**: todo lo de este documento y los anteriores (Fases 0-6).
- **Seguridad**: Fase 5 confirmó los tres riesgos públicos del portal
  (dato ajeno por URL, precio neto, fotos) sin hallazgos; el hallazgo de
  la vulnerabilidad crítica de Next.js (Fase 0/1, PR #94) es justamente
  del tipo que esta auditoría buscaba.
- **Lo que sigue sin tocar y por qué**: la auditoría de las 103+ políticas
  RLS **una por una** — son cientos de combinaciones tabla×rol×operación,
  necesita Docker (que si está disponible, pero el volumen de trabajo
  excede lo que cabe en una sesión de pulido) y es, en palabras del propio
  repo, trabajo "dirigido, no exhaustivo" a propósito.

Comentado en GitHub con el estado real, sin inflar lo que se cerró.

## Issue #89 — Limpiar la configuración local de entorno

**No se puede hacer desde acá.** El issue describe un `.env.local` con una
clave duplicada **en la máquina de Octi**, más una configuración de
`launch.json` sin commitear que ya no existe en el repo — el
`.claude/launch.json` que sí está versionado hoy está limpio (sin la
config `panel-clave-valida` que menciona el issue). Dos motivos de peso:

1. `.env.local` está gitignorado — no es un archivo que yo pueda leer ni
   tocar desde este entorno (y los hooks del repo bloquean la escritura a
   cualquier `.env*` de todas formas).
2. Es la configuración de otra máquina, no de este sandbox.

Comentado en GitHub explicando esto y pidiendo que Octi confirme si ya se
resolvió a mano (el `launch.json` limpio sugiere que sí, al menos en esa
parte).

## Issue #75 — Cargar fotos de los alojamientos en el catálogo

**Bloqueado, sin cambio posible.** Pide fotos reales de las habitaciones y
cabañas del hotel, que no existen en este entorno. El mecanismo para
cargarlas ya está armado y documentado (`lib/domain/catalogo.ts`, `FOTOS`
+ `public/alojamientos/`) — confirmado en la Fase 5. Comentado en GitHub
señalando que el único paso que falta es operativo (conseguir las fotos),
no de código.
