import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Contrato: un `timestamptz` no se corta con `.slice(0, 10)`.
 *
 * Ese corte da el día **UTC**. El hotel está en UTC−3, así que entre las 21:00 y
 * la medianoche de El Calafate el día sale corrido al siguiente: un cobro de las
 * 22:00 quedaba fechado mañana y no casaba con el movimiento del banco en la
 * conciliación, y las pantallas mostraban «creada el» con un día de más. Va
 * `fechaDelHotel()` de `lib/fechas.ts`.
 *
 * Se detecta por el nombre: en este esquema las columnas `timestamptz` terminan
 * en `_en` (`creado_en`, `emitida_en`, `corrida_en`…), y las `date` no. Cuando
 * el valor ya pasó a un objeto de la app el nombre va en camelCase (`venceEn`,
 * `creadoEn`) y es el mismo instante: el patrón cubre las dos formas. La
 * versión que sólo miraba `_en` dejó pasar `l.venceEn.slice(0, 10)` en la
 * cuenta de la reserva.
 */
const SRC = join(process.cwd(), 'src')
const PATRON = /\b\w+(?:_en|En)\??\.slice\(\s*0\s*,\s*10\s*\)/

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : []
  })
}

describe('contrato: los timestamps se cortan en el día del hotel', () => {
  it('ningún `<algo>_en.slice(0, 10)` ni `<algo>En.slice(0, 10)` en src/', () => {
    const encontrados = archivos(SRC).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((linea, i) => ({ linea, i }))
        .filter(({ linea }) => PATRON.test(linea) && !linea.trim().startsWith('*') && !linea.trim().startsWith('//'))
        .map(({ i }) => `${relative(process.cwd(), f)}:${i + 1}`),
    )
    expect(encontrados).toEqual([])
  })
})
