import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Contrato: el embed `facturas` desde una reserva NO se lee como arreglo.
 *
 * `facturas.reserva_id` es único (una factura por reserva, migración 0045), así
 * que PostgREST lo devuelve como **objeto o `null`**. `.length` sobre `null`
 * tiraba abajo el tablero entero, y `[0]` sobre el objeto daba `undefined` en
 * silencio (la factura «no existía»). Va `comoLista()` de `lib/domain/listas.ts`.
 */
const SRC = join(process.cwd(), 'src')
const PATRON = /\.facturas(\?)?\.(length\b|\[0\])|\.facturas\?\.\[0\]|\(\w+\.facturas \?\? \[\]\)/

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : []
  })
}

describe('contrato: embeds a-uno', () => {
  it('nadie lee `facturas` (de una reserva) como arreglo', () => {
    const encontrados = archivos(SRC).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((linea, i) => ({ linea, i }))
        .filter(({ linea }) => PATRON.test(linea))
        .map(({ i }) => `${relative(process.cwd(), f)}:${i + 1}`),
    )
    expect(encontrados).toEqual([])
  })
})
