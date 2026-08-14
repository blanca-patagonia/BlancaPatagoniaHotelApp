---
description: Revisa el diff actual contra el checklist del proyecto y devuelve hallazgos priorizados
---

Revisá los cambios de esta rama.

## Cómo

Delegá al subagente `reviewer` (`.claude/agents/reviewer.md`), que trabaja con contexto limpio y solo
lectura. Pasale el alcance:

```bash
git branch --show-current
git diff main...HEAD --stat
```

Si el diff es chico —menos de unos 150 renglones— revisalo vos directo: delegar cuesta más de lo que
ahorra.

## Qué exigirle al resultado

- Cada hallazgo con **`archivo:línea`** y el fragmento real. Nada sin verificar.
- Ordenados por severidad: corrección > seguridad > performance > mantenibilidad > estilo.
- Por cada uno: qué está mal → qué se rompe en concreto → fix propuesto.

El detalle completo del checklist está en el skill de revisión del proyecto
(`.claude/skills/revisar-codigo/SKILL.md`).

## Los tres de siempre en este repo

1. `const { data } = await supabase...` sin mirar `{ error }` — la escritura falla en silencio.
2. Server Action sin `requerirAcceso(area)` — son endpoints HTTP públicos.
3. Literal `['admin','gerencia']` en vez de `lib/domain/permisos.ts` — ya hay 19 casos.

## Salida

Los hallazgos, de más grave a menos. Después, una línea: se puede mergear, o qué bloquea.

Si no hay nada serio, decilo en una línea. No infles la lista para parecer riguroso.
