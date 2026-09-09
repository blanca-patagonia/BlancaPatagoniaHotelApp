import { describe, it, expect } from 'vitest'
import { claveBorradorReserva } from '@/lib/domain/borrador-reserva'

describe('claveBorradorReserva', () => {
  it('arma una clave estable para la misma búsqueda', () => {
    expect(claveBorradorReserva('2026-09-10', '2026-09-13', 2)).toBe(
      claveBorradorReserva('2026-09-10', '2026-09-13', 2),
    )
  })

  it('distingue búsquedas con fechas distintas', () => {
    expect(claveBorradorReserva('2026-09-10', '2026-09-13', 2)).not.toBe(
      claveBorradorReserva('2026-09-11', '2026-09-13', 2),
    )
  })

  it('distingue búsquedas con cantidad de huéspedes distinta', () => {
    expect(claveBorradorReserva('2026-09-10', '2026-09-13', 2)).not.toBe(
      claveBorradorReserva('2026-09-10', '2026-09-13', 3),
    )
  })
})
