---
description: Explicar un módulo o flujo del sistema con diagrama y rutas reales
argument-hint: [módulo, pantalla o flujo]
---

Explicá esto: $ARGUMENTS

Leyendo el código real, no la documentación. Si `docs/` dice algo que el código no hace, **esa
discrepancia es parte de la respuesta** y vale más que el resto.

## Qué devolver

**1. Qué hace, en dos frases.** Para qué existe, quién lo usa. Sin preámbulo.

**2. El flujo de punta a punta**, con el archivo real de cada eslabón:

```
pantalla (app/panel/x/page.tsx)
  → Server Action (app/panel/x/actions.ts:NN)
    → regla de negocio (lib/domain/x.ts:NN)
    → consulta (supabase.from('tabla'))
      → política RLS (supabase/migrations/00NN_*.sql:NN)
```

**3. Un diagrama mermaid** — de secuencia si es un flujo, ER si es modelo de datos, de componentes si
es estructura. Solo si aclara algo: un diagrama que repite la lista de arriba sobra.

**4. Las decisiones que lo explican.** Buscá en `docs/decisiones/` (hay 16 ADRs). Por qué está hecho
así suele importar más que cómo.

**5. Dónde tocarlo.** Si alguien tiene que cambiar esto mañana, qué archivo abre primero y qué se
rompe si se equivoca.

## Cómo trabajar

Si son más de tres o cuatro archivos, delegá al subagente `explorer`: devuelve el mapa comprimido sin
inflar el contexto.

Sé concreto. Nada de "gestiona la lógica de negocio": decí qué calcula, con qué entrada y qué
devuelve.

Si hay algo que no entendés del código, decilo. Una explicación con un hueco marcado es honesta;
una que rellena el hueco con una suposición plausible es peor que no explicar.
