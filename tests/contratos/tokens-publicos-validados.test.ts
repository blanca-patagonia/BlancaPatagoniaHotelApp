import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contrato: toda ruta pública con token comprueba que sea un UUID ANTES de
 * consultar la base.
 *
 * `reservas.token` y `encuestas_satisfaccion.token` son columnas `uuid`. Con un
 * valor que no lo es, PostgREST responde 400 (`22P02`) y la página lo anotaba en
 * `/panel/errores`: cualquiera, sin cuenta, podía llenar el registro de errores
 * —y tapar las alertas reales— con una consulta por dirección inventada.
 */
const PUBLICO = join(process.cwd(), 'src', 'app', '(front-publico)')

const PAGINAS = [
  'reservar/confirmacion/[token]/page.tsx',
  'reservar/pagar/[token]/page.tsx',
  'reservar/factura/[token]/page.tsx',
  'encuesta/[token]/page.tsx',
]
const ACCIONES = ['reservar/pagar/[token]/actions.ts', 'encuesta/[token]/actions.ts']

describe('contrato: los tokens públicos se validan antes de consultar', () => {
  for (const archivo of PAGINAS) {
    it(`${archivo} corta con 404 si el token no es UUID`, () => {
      const codigo = readFileSync(join(PUBLICO, archivo), 'utf8')
      const guarda = codigo.indexOf('if (!esUuid(token)) notFound()')
      const consulta = codigo.indexOf('.eq(\'token\', token)')
      expect(guarda, 'falta la guarda esUuid').toBeGreaterThan(-1)
      expect(guarda, 'la guarda va antes de la consulta').toBeLessThan(consulta)
    })
  }

  for (const archivo of ACCIONES) {
    it(`${archivo} descarta un token que no es UUID`, () => {
      const codigo = readFileSync(join(PUBLICO, archivo), 'utf8')
      expect(codigo).toMatch(/if \(!esUuid\(token\)\) redirect\(/)
    })
  }
})
