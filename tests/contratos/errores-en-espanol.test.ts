import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Contrato: el mensaje de la base no llega al usuario.
 *
 * Un `return { error: \`No se pudo …: ${error.message}\` }` le muestra a quien
 * usa el sistema el texto de Postgres en inglés —«duplicate key value violates
 * unique constraint…»— y además deja en pantalla nombres de tablas y
 * restricciones. Va `mensajeDeFalla()` de `lib/acciones.ts`, que registra el
 * detalle en `/panel/errores` y traduce los casos con arreglo.
 *
 * Se detecta un `error:` cuyo valor es un template que interpola un
 * `.message`. Los `throw new Error(…${error.message})` no entran: los atrapa un
 * error boundary, que no muestra el texto, y el detalle sirve en el registro.
 */
const SRC = join(process.cwd(), 'src')
const PATRON = /\berror:\s*`[^`]*\$\{[^}]*\.message\b[^}]*\}/

/**
 * Archivos donde `error` no es lo que ve el usuario, con el motivo escrito.
 * El test exige que el motivo exista: una excepción sin porqué no se acepta.
 */
const EXCEPCIONES: Record<string, string> = {
  'src/lib/reservas/saldar.ts':
    'el `error` de `ResultadoSaldar` es interno: el mostrador lo pasa a `cortarSiFalla` (va al registro, a la URL sólo un motivo) y el webhook lo registra',
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : []
  })
}

describe('contrato: los errores que ve el usuario van en español', () => {
  it('ningún `error:` devuelto interpola el `.message` de la base', () => {
    const encontrados = archivos(SRC).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((linea, i) => ({ linea, i }))
        .filter(({ linea }) => PATRON.test(linea) && !linea.trim().startsWith('*') && !linea.trim().startsWith('//'))
        .map(({ i }) => `${relative(process.cwd(), f)}:${i + 1}`),
    )
    const sinExcepcion = encontrados.filter((ubicacion) => !(ubicacion.split(':')[0] in EXCEPCIONES))
    expect(sinExcepcion).toEqual([])
  })

  it('cada excepción tiene su motivo escrito', () => {
    for (const [archivo, motivo] of Object.entries(EXCEPCIONES)) {
      expect(motivo.length, archivo).toBeGreaterThan(20)
    }
  })
})
