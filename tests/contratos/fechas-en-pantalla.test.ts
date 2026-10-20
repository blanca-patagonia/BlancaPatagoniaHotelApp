import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Contrato: una fecha u hora se formatea con los helpers de `lib/fechas.ts`.
 *
 * `toLocaleDateString` / `toLocaleTimeString` sin `timeZone` toman la zona del
 * proceso, que en Vercel es UTC: entre las 21:00 y la medianoche de El Calafate
 * la fecha sale corrida un día y la hora tres adelantada. Además el ICU de Node
 * formatea `es-AR` en 12 horas sin a. m./p. m. Estaba en 14 pantallas y se
 * migraron a `fechaHotel()`, `fechaHoraHotel()` y `horaHotel()`, que fijan
 * `ZONA_HOTEL` y el reloj de 24 horas. Hoy hay cero fuera de `lib/fechas.ts`;
 * esto es para que siga en cero.
 *
 * `toLocaleString` no entra: también se usa —correctamente— para cantidades.
 */
const SRC = join(process.cwd(), 'src')
const PERMITIDO = join('src', 'lib', 'fechas.ts')
const PATRON = /\.toLocale(?:Date|Time)String\(/

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : []
  })
}

describe('contrato: las fechas en pantalla van por lib/fechas', () => {
  it('ningún `toLocaleDateString` ni `toLocaleTimeString` fuera de lib/fechas.ts', () => {
    const encontrados = archivos(SRC)
      .filter((f) => relative(process.cwd(), f) !== PERMITIDO)
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((linea, i) => ({ linea, i }))
          .filter(({ linea }) => PATRON.test(linea) && !linea.trim().startsWith('*') && !linea.trim().startsWith('//'))
          .map(({ i }) => `${relative(process.cwd(), f)}:${i + 1}`),
      )
    expect(encontrados).toEqual([])
  })
})
