import { describe, it, expect } from 'vitest'
import { validarCapacidad } from '@/lib/domain/unidades'

/**
 * El límite de capacidad vivía solo en el filtro de la pantalla del portal
 * público. `crearReservaPublica` es un endpoint HTTP: tomaba la cantidad con
 * `Math.max(1, …)` —que pone piso pero no techo— así que un envío directo con
 * `huespedes: 50` sobre una habitación doble entraba sin objeción.
 */

describe('validarCapacidad', () => {
  it('acepta una cantidad que entra', () => {
    expect(validarCapacidad(2, 4)).toBeNull()
  })

  it('acepta el borde exacto', () => {
    expect(validarCapacidad(4, 4)).toBeNull()
  })

  it('rechaza una persona de más y dice cuántas entran', () => {
    expect(validarCapacidad(5, 4)).toBe('Ese alojamiento admite hasta 4 personas.')
  })

  it('rechaza el caso que motivó el arreglo: 50 en una doble', () => {
    expect(validarCapacidad(50, 2)).toBe('Ese alojamiento admite hasta 2 personas.')
  })

  it('concuerda el singular cuando la capacidad es de una persona', () => {
    expect(validarCapacidad(2, 1)).toBe('Ese alojamiento admite hasta 1 persona.')
  })

  it('rechaza cero y negativos', () => {
    expect(validarCapacidad(0, 4)).not.toBeNull()
    expect(validarCapacidad(-3, 4)).not.toBeNull()
  })

  it('rechaza una cantidad no entera', () => {
    expect(validarCapacidad(2.5, 4)).not.toBeNull()
  })

  it('sin capacidad conocida rechaza, en vez de asumir que entran', () => {
    expect(validarCapacidad(2, 0)).toBe('No se pudo verificar la capacidad de ese alojamiento.')
    expect(validarCapacidad(2, Number.NaN)).toBe(
      'No se pudo verificar la capacidad de ese alojamiento.',
    )
  })
})
