import { describe, it, expect } from 'vitest'
import {
  mesRelativo,
  ultimosMeses,
  metricasDeMes,
  variacionPct,
  etiquetaMes,
  type EstadiaMetrica,
} from '@/lib/domain/metricas'

describe('aritmética de meses', () => {
  it('avanza y retrocede dentro del año', () => {
    expect(mesRelativo('2026-05', 1)).toBe('2026-06')
    expect(mesRelativo('2026-05', -2)).toBe('2026-03')
  })

  it('cruza el cambio de año', () => {
    expect(mesRelativo('2026-01', -1)).toBe('2025-12')
    expect(mesRelativo('2026-12', 1)).toBe('2027-01')
    expect(mesRelativo('2026-02', -14)).toBe('2024-12')
  })

  it('lista los últimos meses en orden cronológico', () => {
    expect(ultimosMeses('2026-03', 4)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03'])
  })
})

describe('métricas hoteleras del mes', () => {
  // Enero 2026 tiene 31 días; con 2 unidades hay 62 noches disponibles.
  const UNIDADES = 2

  it('sin estadías da todo en cero pero conserva la capacidad', () => {
    const m = metricasDeMes([], '2026-01', UNIDADES)
    expect(m.nochesDisponibles).toBe(62)
    expect(m.nochesVendidas).toBe(0)
    expect(m.ocupacionPct).toBe(0)
    expect(m.adr).toBe(0)
    expect(m.revpar).toBe(0)
  })

  it('calcula ocupación, ADR y RevPAR', () => {
    // 10 noches a USD 100 => ingreso 1000.
    const estadias: EstadiaMetrica[] = [{ periodo: '[2026-01-05,2026-01-15)', precio_noche: 100 }]
    const m = metricasDeMes(estadias, '2026-01', UNIDADES)
    expect(m.nochesVendidas).toBe(10)
    expect(m.ingreso).toBe(1000)
    expect(m.ocupacionPct).toBe(16) // 10/62 = 16,1 %
    expect(m.adr).toBe(100)
    expect(m.revpar).toBe(16) // 1000/62 = 16,1
  })

  it('prorratea una estadía a caballo entre dos meses', () => {
    // Del 28/01 al 03/02: 4 noches caen en enero y 2 en febrero.
    const estadias: EstadiaMetrica[] = [{ periodo: '[2026-01-28,2026-02-03)', precio_noche: 50 }]
    expect(metricasDeMes(estadias, '2026-01', UNIDADES).nochesVendidas).toBe(4)
    expect(metricasDeMes(estadias, '2026-02', UNIDADES).nochesVendidas).toBe(2)
    expect(metricasDeMes(estadias, '2026-01', UNIDADES).ingreso).toBe(200)
  })

  it('ignora las estadías de otros meses', () => {
    const estadias: EstadiaMetrica[] = [{ periodo: '[2026-03-01,2026-03-05)', precio_noche: 80 }]
    expect(metricasDeMes(estadias, '2026-01', UNIDADES).nochesVendidas).toBe(0)
  })

  it('tolera un precio nulo', () => {
    const estadias: EstadiaMetrica[] = [{ periodo: '[2026-01-01,2026-01-03)', precio_noche: null }]
    const m = metricasDeMes(estadias, '2026-01', UNIDADES)
    expect(m.nochesVendidas).toBe(2)
    expect(m.ingreso).toBe(0)
  })

  it('sin unidades activas no hay capacidad ni división por cero', () => {
    const m = metricasDeMes([{ periodo: '[2026-01-01,2026-01-03)', precio_noche: 90 }], '2026-01', 0)
    expect(m.nochesDisponibles).toBe(0)
    expect(m.ocupacionPct).toBe(0)
    expect(m.revpar).toBe(0)
  })
})

describe('variación porcentual', () => {
  it('calcula subidas y bajadas', () => {
    expect(variacionPct(120, 100)).toBe(20)
    expect(variacionPct(80, 100)).toBe(-20)
  })

  it('no compara contra cero', () => {
    expect(variacionPct(50, 0)).toBeNull()
  })
})

describe('etiqueta de mes', () => {
  it('abrevia mes y año', () => {
    expect(etiquetaMes('2026-01')).toBe('ene 26')
    expect(etiquetaMes('2025-12')).toBe('dic 25')
  })
})
