import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { esVista } from '@/lib/domain/vistas-reservas'

/**
 * Lo que el tablero de Inicio anuncia es lo que abre.
 *
 * Al probar la demo, el docente tocó «7 reservas con saldo pendiente de cobro» y
 * el enlace abrió el listado entero: el aviso apuntaba a `/panel/reservas` sin
 * filtro. Este contrato lee el tablero y exige que todo enlace al listado de
 * reservas lleve una vista existente. Un número que abre «todas» no dice nada.
 */
const TABLERO = join(process.cwd(), 'src/app/(front-gestion)/panel/page.tsx')

describe('enlaces del tablero de Inicio', () => {
  const codigo = readFileSync(TABLERO, 'utf8')
  const enlaces = [...codigo.matchAll(/['"`](\/panel\/reservas[^'"`]*)['"`]/g)].map((m) => m[1])

  it('hay enlaces al listado de reservas (si no, el contrato no prueba nada)', () => {
    expect(enlaces.length).toBeGreaterThan(0)
  })

  it('ninguno abre el listado sin filtro', () => {
    const sinFiltro = enlaces.filter((e) => e === '/panel/reservas')
    expect(sinFiltro, 'un aviso del tablero abre el listado entero').toEqual([])
  })

  it('las vistas a las que apuntan existen', () => {
    for (const e of enlaces) {
      // `/panel/reservas/nueva` es el alta, no el listado.
      if (e.startsWith('/panel/reservas/')) continue
      const vista = new URLSearchParams(e.split('?')[1] ?? '').get('vista') ?? undefined
      expect(esVista(vista), `vista inexistente en ${e}`).toBe(true)
    }
  })
})
