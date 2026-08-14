---
description: Corre lint, typecheck, tests y build; reporta solo lo que falla con el fix propuesto
---

Verificá el proyecto completo. Corré los cuatro comandos **en este orden** y no te detengas en el
primero que falle: quiero el panorama entero de una.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Cómo reportar

**Solo lo que falla.** Si algo pasa, una línea con ✅ y seguís. Nadie necesita leer la salida
completa de un build que salió bien.

Por cada error:
1. `archivo:línea`
2. Qué dice el error, en castellano y sin jerga
3. El fix concreto — el código, no una descripción del código

## Lo que no podés omitir

`npm test` sale en verde **con tests salteados** si no hay base local. Reportá siempre el conteo:

> 344 pasan · **43 salteados** (necesitan Docker + `npx supabase start`)

Entre los salteados está el anti-overbooking, que es la garantía central del sistema. Verde con 43
sin ejecutar **no es verde**, y decirlo es parte del informe.

Si Docker está disponible, ofrecé correr la suite completa:

```bash
npx supabase start && npm run seed:usuarios && EXIGIR_DB=1 npm test
```

## Al final

Una tabla de cuatro filas con el estado de cada comando, y una frase: listo para commitear, o qué
falta. Nada más.
