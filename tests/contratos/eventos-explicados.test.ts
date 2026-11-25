import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describirEvento } from '@/lib/domain/errores'

/**
 * Todo evento que el sistema registra tiene una explicación en palabras del hotel.
 *
 * «Errores del sistema» mostraba sólo el nombre técnico (`escritura_accesoria_fallida`)
 * y el docente, al probar la demo, no pudo saber qué significaba. Este contrato
 * lee el código: un evento nuevo que cae en «Otro» lo hace fallar y obliga a
 * decidir cómo se le explica a quien administra el hotel (`lib/domain/errores.ts`).
 */
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n)
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : []
  })
}

describe('eventos de «Errores del sistema»', () => {
  const eventos = new Set<string>()
  for (const f of archivos(join(process.cwd(), 'src'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/registrar(?:Error|Aviso|ErrorSync)\(\s*'([a-z_]+)'/g)) {
      eventos.add(m[1])
    }
  }

  it('encuentra los eventos (si no, el contrato no prueba nada)', () => {
    expect(eventos.size).toBeGreaterThan(20)
  })

  it('ninguno queda sin explicación', () => {
    const sinExplicar = [...eventos].filter((e) => describirEvento(e).area === 'Otro')
    expect(sinExplicar).toEqual([])
  })
})
