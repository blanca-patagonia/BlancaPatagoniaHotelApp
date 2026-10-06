# Fase 7 (acotada) — Corregir la deriva de README/CLAUDE.md/PENDIENTES (2026-10-06)

> Acotada por el mensaje 2 del brief a README.md, CLAUDE.md y
> `docs/PENDIENTES.md` vs `docs/analisis-pendientes-2026-09-09.md`. El punto
> "que la documentación refleje lo que cambiaste" (`COMO-LEVANTARLO.md`,
> `AGENTS.md`, manuales) queda para el cierre final, como pide el brief.

## 1. `README.md`

Todos los números verificados contra el repo real (no copiados de otro
documento):

| Antes (falso) | Ahora (verificado) |
|---|---|
| "1914 tests en verde (118 archivos)" ×2 | 2294 tests (146 archivos) |
| "RLS activado en las 51 tablas (103 políticas)" | "todas las tablas (bastante más de 103 políticas sobre 56 tablas, y sigue creciendo)" — tomado de la frase ya vigente en `CLAUDE.md`, no inventado de nuevo |
| "24 archivos escriben con `service_role`" | 29 (`grep -rl clienteDePrueba tests/*.test.ts \| wc -l`) |
| "22 decisiones de arquitectura numeradas" | 40 |
| "83 migraciones SQL numeradas" | 108 |
| Link "Auditoría de seguridad" → `docs/audit/` | Redirigido al documento vigente de pendientes + los issues de GitHub; `docs/audit/` y `docs/PENDIENTES.md` quedan citados como históricos (ver §3) |

**No se tocó** la sección "Lo que todavía no está" más allá de estos
números: la mención a la atomicidad de reservas sigue describiendo el
estado real de `main` (el fix de esa sesión anterior vive en una rama sin
integrar, fuera del alcance de esta corrida — ver `progreso.md`).

## 2. `CLAUDE.md`

- **Conteo de ADRs.** "Hay 35 ADRs, el último es el 0035" → "Hay 39 ADRs,
  numerados hasta el 0040". No es un error de tipeo: al verificar se
  encontró que **el ADR 0034 nunca existió como archivo** — era la decisión
  de WhatsApp por Cloud API de Meta, descartada antes de escribirse (el
  propio `CLAUDE.md`, más abajo, ya lo explicaba: "la pieza de WhatsApp...
  NO entró con esta pasada"). Se extendió la cadena út­imo→anterior→previo
  con los ADRs 0036 a 0040 (cifrado de credenciales de terceros, Storage
  para fotos operativas, Payway, asistente de IA de solo lectura,
  inventario físico real) y se corrigió la mención suelta al "0034" para no
  repetir la confusión.
- **Pendiente resuelto, no detectado como tal.** La última línea decía
  "pendiente de confirmar con el hotel: inventario físico real de unidades
  y tarifa rack de cabañas" — pero el **inventario físico real ya se hizo**
  (ADR 0040, migraciones 0106-0108: nombres reales, baja de las cabañas
  ficticias del seed). Se marcó esa mitad como resuelta y se dejó la tarifa
  rack de cabañas, que sigue sin confirmar.
- **"Deploy pendiente" — NO se tocó, a propósito.** El brief pide confirmar
  con Octi antes de corregir esta línea, y `docs/analisis-pendientes-
  2026-09-09.md` ya la había señalado como posible deriva (dice "5 crons";
  verificado hoy contra `vercel.json`, son **6**: canales, salud, mantenimiento,
  notificaciones, recordatorios y ari). La pregunta sigue abierta — ¿el
  sistema llegó a desplegarse de verdad, o los crons están configurados
  para cuando se despliegue? — y no es algo que se pueda inferir leyendo
  código.

## 3. `docs/PENDIENTES.md` vs `docs/analisis-pendientes-2026-09-09.md`

**Decisión: `docs/analisis-pendientes-2026-09-09.md` queda como el vigente;
`docs/PENDIENTES.md` se marca histórico** (congelado en migración 0064,
con una nota al tope que dice exactamente eso y linkea al vigente). Motivo:
es más reciente, está explícitamente verificado contra el código ("no
inventado") y la mayoría de los items de `PENDIENTES.md` que seguían
abiertos ya están resumidos o superados ahí.

**Hallazgo no pedido, pero que había que decir:** ninguno de los dos es hoy
la fuente más actual. Desde el PR #90 (2026-10-01) el proyecto trackea
pendientes como **issues de GitHub** (21 abiertos, #68 a #89, con labels de
prioridad y área) — un mecanismo que no existía cuando se escribió ninguno
de los dos documentos. Se agregó una nota al documento vigente explicando
esto, en vez de fusionar todo a las apuradas: los issues tienen label y
prioridad; los documentos tienen el **porqué** de cada pendiente, que es
lo que un issue de GitHub normalmente no lleva. Mezclarlos sin cuidado
perdería esa segunda mitad.

## 4. Lo que queda para el cierre final (no esta corrida)

- `COMO-LEVANTARLO.md` tiene la misma deriva que tenía `README.md`: "67
  migraciones", "1555 tests", "27 ADRs". No se tocó — está fuera del
  recorte explícito de esta corrida.
- `AGENTS.md` dice "24 archivos" con `service_role` (hoy 29, mismo número
  que se corrigió en `README.md`) y referencia "105 políticas sobre 52
  tablas" en su diagrama de capas (`CLAUDE.md` ya dice "bastante más de
  103... sobre 56 tablas, y sigue creciendo" — otra inconsistencia entre
  los dos archivos base del repo, con tres números distintos para la misma
  cosa). Fuera del recorte de esta corrida.
- `docs/manual-usuario.md` y `docs/manual-tecnico.md`: no se auditaron en
  esta corrida (el brief los deja para el punto "que reflejen lo que
  cambiaste", al cierre).
