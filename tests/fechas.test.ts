import { describe, it, expect } from 'vitest'
import {
  sumarDias,
  diasEntre,
  listaDias,
  parsearPeriodo,
  contieneDia,
} from '@/lib/fechas'

describe('utilidades de fecha', () => {
  it('suma días cruzando meses', () => {
    expect(sumarDias('2025-11-28', 5)).toBe('2025-12-03')
  })

  it('cuenta noches entre dos fechas', () => {
    expect(diasEntre('2025-11-10', '2025-11-13')).toBe(3)
  })

  it('genera una lista de días consecutivos', () => {
    expect(listaDias('2025-11-10', 3)).toEqual(['2025-11-10', '2025-11-11', '2025-11-12'])
  })

  it('parsea un daterange de Postgres', () => {
    expect(parsearPeriodo('[2026-07-27,2026-07-30)')).toEqual({
      desde: '2026-07-27',
      hasta: '2026-07-30',
    })
  })

  it('evalúa la pertenencia de un día al período [desde, hasta)', () => {
    const p = { desde: '2025-11-10', hasta: '2025-11-13' }
    expect(contieneDia(p, '2025-11-10')).toBe(true)
    expect(contieneDia(p, '2025-11-12')).toBe(true)
    expect(contieneDia(p, '2025-11-13')).toBe(false) // check-out: libre
  })
})
