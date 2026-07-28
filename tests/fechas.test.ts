import { describe, it, expect } from 'vitest'
import {
  sumarDias,
  diasEntre,
  listaDias,
  parsearPeriodo,
  contieneDia,
  nochesEnVentana,
  inicioFinDeMes,
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

  it('prorratea las noches de una estadía dentro de una ventana', () => {
    const { inicio, fin } = inicioFinDeMes('2025-11')
    expect(nochesEnVentana({ desde: '2025-11-10', hasta: '2025-11-13' }, inicio, fin)).toBe(3)
    // Estadía a caballo entre octubre y noviembre → solo cuentan las de noviembre.
    expect(nochesEnVentana({ desde: '2025-10-30', hasta: '2025-11-03' }, inicio, fin)).toBe(2)
    // Fuera de la ventana → 0.
    expect(nochesEnVentana({ desde: '2025-12-01', hasta: '2025-12-05' }, inicio, fin)).toBe(0)
  })

  it('calcula inicio y fin (exclusivo) de un mes, incluido diciembre', () => {
    expect(inicioFinDeMes('2025-11')).toEqual({ inicio: '2025-11-01', fin: '2025-12-01' })
    expect(inicioFinDeMes('2025-12')).toEqual({ inicio: '2025-12-01', fin: '2026-01-01' })
  })
})
