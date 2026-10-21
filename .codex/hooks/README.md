# Hooks del proyecto

Los hooks son la diferencia entre una regla que se cumple **casi siempre** y una que se cumple
**siempre**. Lo que está acá no depende de que el agente se acuerde.

Se configuran en `.claude/settings.json` (versionado, vale para todo el equipo).
Para desactivar uno temporalmente en tu máquina, copiá el bloque a `.claude/settings.local.json`
(gitignored) con la lista de hooks vacía.

| Script | Evento | Matcher | Bloquea | Timeout |
|---|---|---|---|---|
| `proteger-archivos.sh` | PreToolUse | `Write\|Edit` | sí (exit 2) | 5 s |
| `detectar-secretos.sh` | PreToolUse | `Write\|Edit` | sí (exit 2) | 5 s |
| `bloquear-destructivos.sh` | PreToolUse | `Bash` | sí (exit 2) | 5 s |
| `formatear.sh` | PostToolUse | `Write\|Edit` | no | 30 s |
| `al-terminar.sh` | Stop | — | no | 120 s |
| `al-iniciar.sh` | SessionStart | — | no | 15 s |

## Qué bloquea cada uno

**`proteger-archivos.sh`** — `.env*`, lockfiles, `next-env.d.ts`, `.next/`, y **migraciones ya
aplicadas**. Distingue editar una que existe (bloquea) de crear una nueva (permite), y el mensaje
te dice con qué número sigue. Sobre `AGENTS.md` no bloquea: avisa que preserves el bloque generado
por Next entre `BEGIN:nextjs-agent-rules` y `END:nextjs-agent-rules`.

**`detectar-secretos.sh`** — claves de Supabase (`sb_secret_`), JWT, `sk-`, MercadoPago (`APP_USR-`),
Stripe (`sk_live_`/`sk_test_`), secretos de webhook (`whsec_`), claves privadas PEM y asignaciones
literales de contraseña o token. No revisa `.env.example` ni archivos `.md`, que llevan placeholders
legítimos. Se bloquea **antes** de escribir porque un secreto commiteado queda en el historial de git
para siempre.

**`bloquear-destructivos.sh`** — `rm -rf`, `git push --force`, `git reset --hard`, `git clean -f`,
`checkout main`, `DROP DATABASE/SCHEMA/TABLE` y `supabase db reset` (que borra los usuarios de auth y
deja `perfiles` vacía; ver la trampa documentada en `CLAUDE.md`).

## Qué NO bloquea

**`formatear.sh`** corre `eslint --fix` sobre el archivo tocado. El proyecto **no tiene Prettier**:
si querés formateo real, hay que agregarlo como dependencia y eso es una decisión del equipo, no de
un hook.

**`al-terminar.sh`** corre la suite y, además de los fallos, informa **cuántos tests se saltearon**.
Hoy son 43 sin base local, e incluyen el anti-overbooking. Verde con 43 sin ejecutar no es verde.

**`al-iniciar.mjs`** muestra rama, estado de git, última migración y si hay base local para
los tests (el sistema en sí corre contra Supabase en la nube, sin Docker).

## Hook que decidí NO escribir

El pedido original incluía un **typecheck incremental** por archivo en `PostToolUse`. No lo escribí,
y es a propósito: `tsc --noEmit` sobre un archivo suelto ignora el `tsconfig.json` del proyecto —
se pierden los `paths` del alias `@/` y los tipos de rutas que genera `next typegen`. El resultado
serían errores falsos en cada guardado, y **un hook que miente es peor que no tener hook**: enseña
al equipo a ignorar las alertas.

El typecheck real corre en `/check` y en CI, sobre el proyecto entero, que es donde tiene sentido.

## Probarlos a mano

```bash
# Debe BLOQUEAR (exit 2)
echo '{"tool_input":{"file_path":".env.local"}}' | .claude/hooks/proteger-archivos.sh

# Debe DEJAR PASAR (exit 0)
echo '{"tool_input":{"file_path":"app/panel/page.tsx"}}' | .claude/hooks/proteger-archivos.sh
```
