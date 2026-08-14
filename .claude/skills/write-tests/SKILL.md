---
name: write-tests
description: Escribir tests en este repo con vitest. Usalo cuando haya que agregar tests, cubrir un bugfix, testear una regla de dominio o una Server Action, o cuando se hable de cobertura, casos borde o tests de integración. Cubre la convención de nombres en español y el patrón skipIf que decide qué corre sin base local.
---

# Escribir tests

Dos familias, y confundirlas es el error más común acá.

| | Dominio puro | Integración |
|---|---|---|
| Dónde | `tests/<modulo>.test.ts` | `tests/acciones/*.test.ts`, `tests/overbooking.test.ts` |
| Qué prueba | Reglas de `lib/domain/**` | Server Actions, RLS, RPC, restricciones de la base |
| Necesita base | No | **Sí** |
| Guarda | ninguna | `describe.skipIf(!hayDB)` |

## Dominio puro — el caso normal

`lib/domain/` no importa Supabase ni React, así que se testea sin nada montado. Modelo canónico:
[tests/cancelacion.test.ts](../../../tests/cancelacion.test.ts).

```ts
import { describe, it, expect } from 'vitest'
import { cargoPorCancelacion, type ReglaCancelacion } from '@/lib/domain/cancelacion'

// Política estándar del Tarifario Blanca Patagonia.
const reglas: ReglaCancelacion[] = [
  { desde_dias: 14, cargo: 'ninguno' },
  { desde_dias: 7, cargo: 'primera_noche' },
  { desde_dias: 0, cargo: 'total' },
]

describe('cargoPorCancelacion', () => {
  it('no cobra si se cancela con más de 14 días', () => {
    expect(cargoPorCancelacion(reglas, 20)).toBe('ninguno')
    expect(cargoPorCancelacion(reglas, 14)).toBe('ninguno')   // ← el borde exacto
  })
})
```

Convenciones que se respetan sin discusión:
- `describe` con el nombre de la función; `it` con **una frase en español** que describe la regla
  de negocio, no la mecánica. "cobra el total dentro de los 7 días", no "returns total".
- Fixtures como `const` arriba del `describe`. **No hay factories** en este repo: los datos se arman
  a mano y así está bien para reglas puras.
- Sin mocks. Si necesitás mockear algo para testear dominio, el dominio está contaminado: arreglá eso.

## Integración — necesita base local

```ts
import { describe, it, expect } from 'vitest'
import { hayDB, clienteDePrueba, sufijoUnico, periodo } from './db'

describe.skipIf(!hayDB)('anti-overbooking (restricción de exclusión)', () => {
  const supabase = clienteDePrueba()   // service_role: prepara y limpia
  ...
})
```

Helpers en [tests/db.ts](../../../tests/db.ts):
`hayDB` · `hayAnon` · `clienteDePrueba()` (service_role) · `clienteAnonimo()` (rol `anon`, para
probar qué ve internet) · `sufijoUnico()` · `periodo(desde, hasta)`.

**Usá `clienteAnonimo()` cuando el test verifique qué NO debe ver un desconocido.** Es el único modo
de probar RLS de verdad.

Limpiá lo que creaste: usá `sufijoUnico()` en los nombres para que dos corridas no colisionen.

## La trampa de los 43 salteados

`npm test` sale **verde con 43 tests sin ejecutar** si no hay base local — entre ellos el
anti-overbooking, que es la garantía central del sistema. Verde acá no significa verificado.

```bash
npm test                          # 344 pasan, 43 saltean
npx supabase start                # levanta la base (necesita Docker)
npm run seed:usuarios             # sin esto fallan los tests de facturación (FK contra perfiles)
EXIGIR_DB=1 npm test              # ahora la falta de base es ERROR, no salto
```

`EXIGIR_DB=1` es lo que corre el CI ([tests/db.ts:22](../../../tests/db.ts)).

## Casos borde que este dominio exige

- **Dinero:** redondeo acumulado noche a noche, IVA sobre la base correcta, neto vs rack, importes
  cero y negativos (reembolsos, notas de crédito).
- **Fechas:** el límite exacto de 14 y 7 días de cancelación (¿inclusivo?), cambios de mes, años
  bisiestos, checkin/checkout el mismo día. El Calafate es UTC-3: probá que el borde no se corra un día.
- **Autorización:** por cada acción, un test que verifique que un rol sin permiso **es rechazado**.
  Testear solo el camino feliz deja la puerta abierta.

## Regla fija

Todo bugfix entra con un test que **fallaba antes** del fix. Escribí el test primero, velo en rojo,
después arreglá.

```bash
npm test -- <patrón>     # un archivo
npm test                 # todo
```
