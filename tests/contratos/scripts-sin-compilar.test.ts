import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Contrato: lo que cargan los comandos de terminal no puede importar con alias.
 *
 * `npm run integraciones` y `npm run configurar` importan TypeScript de `src/`
 * directo con Node, sin compilar (`--experimental-strip-types`). Node no conoce
 * el alias `@/` ni resuelve extensiones: un `import … from '@/lib/x'` o un
 * `from './y'` sin `.ts` adentro de esos archivos hace explotar el comando, y NADA
 * más del sistema lo nota —la app compila, los tests pasan, el build sale verde—.
 * Se descubriría el día que alguien lo corre para conectar WhatsApp.
 *
 * Por eso esos archivos, además, no importan `server-only`, ni `next`, ni nada de
 * `node_modules` que Node no pueda cargar solo: la regla es «sin imports», salvo
 * los relativos con extensión explícita.
 */

const RAIZ = fileURLToPath(new URL('../..', import.meta.url))

const SCRIPTS = ['scripts/verificar-integraciones.mjs', 'scripts/configurar-integraciones.mjs']

function importsDe(archivo: string): string[] {
  const fuente = readFileSync(archivo, 'utf8')
  return [...fuente.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
}

/** Los módulos de `src/` que cargan los scripts, y los que ésos a su vez cargan. */
function alcanzables(): string[] {
  const vistos = new Set<string>()
  const pendientes = SCRIPTS.map((s) => join(RAIZ, s))
  while (pendientes.length) {
    const actual = pendientes.pop() as string
    if (vistos.has(actual)) continue
    vistos.add(actual)
    for (const destino of importsDe(actual)) {
      if (destino.startsWith('.')) pendientes.push(resolve(dirname(actual), destino))
    }
  }
  return [...vistos].filter((f) => f.includes('/src/'))
}

describe('los scripts de terminal cargan TypeScript sin compilar', () => {
  it('cargan al menos el catálogo, las pruebas y la conexión', () => {
    const nombres = alcanzables().map((f) => f.replace(RAIZ, ''))
    expect(nombres).toEqual(
      expect.arrayContaining(['src/lib/domain/integraciones.ts', 'src/lib/integraciones/sondas.ts', 'src/lib/integraciones/meta.ts']),
    )
  })

  for (const script of SCRIPTS) {
    it(`${script}: todo import relativo lleva extensión`, () => {
      const sinExtension = importsDe(join(RAIZ, script)).filter((d) => d.startsWith('.') && !/\.(ts|mjs|js)$/.test(d))
      expect(sinExtension).toEqual([])
    })
  }

  it('ningún módulo de src/ que cargan los scripts importa algo (ni alias, ni paquetes)', () => {
    const conImports = alcanzables()
      .map((f) => ({ f: f.replace(RAIZ, ''), imports: importsDe(f) }))
      .filter((m) => m.imports.length > 0)
    expect(conImports).toEqual([])
  })
})
