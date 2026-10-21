import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { todasLasVariables } from '@/lib/domain/integraciones'

/**
 * Contrato: toda variable que la bandeja lee está en el catálogo de
 * integraciones (ADR 0043).
 *
 * El catálogo es lo que ve quien configura el sistema —la pantalla y
 * `npm run integraciones`—. Una variable que el código lee y el catálogo no
 * nombra es una clave que nadie sabe que tiene que cargar: el canal queda
 * «configurado» en pantalla y no anda.
 *
 * Lee el código fuente en vez de importar los módulos: `lib/bandeja` es
 * `server-only` y no se carga en un test.
 */

const RAIZ = fileURLToPath(new URL('../..', import.meta.url))

const ARCHIVOS = [
  'src/lib/bandeja/canales.ts',
  'src/lib/bandeja/responder.ts',
  'src/lib/bandeja/correo.ts',
  'src/lib/integraciones/meta.ts',
  'src/lib/integraciones/sondas.ts',
  'src/app/(back-api)/api/webhooks/meta/route.ts',
  'src/app/(back-api)/api/webhooks/telegram/route.ts',
]

/** Variables del sistema que no son de ninguna integración. */
const AJENAS = new Set(['NODE_ENV'])

describe('la bandeja sólo lee variables declaradas en el catálogo', () => {
  const catalogo = new Set(todasLasVariables())

  for (const archivo of ARCHIVOS) {
    it(archivo, () => {
      const fuente = readFileSync(`${RAIZ}${archivo}`, 'utf8')
      const leidas = [
        ...fuente.matchAll(/process\.env\.([A-Z0-9_]+)/g),
        ...fuente.matchAll(/env\('([A-Z0-9_]+)'\)/g),
        ...fuente.matchAll(/\bv\(env, '([A-Z0-9_]+)'\)/g),
        ...fuente.matchAll(/'([A-Z][A-Z0-9_]+_(?:TOKEN|SECRET|KEY|ID|FROM))'/g),
      ].map((m) => m[1])
      const faltan = [...new Set(leidas)].filter((v) => !AJENAS.has(v) && !catalogo.has(v))
      expect(faltan).toEqual([])
    })
  }
})
