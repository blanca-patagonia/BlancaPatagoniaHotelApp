import { describe, it, expect } from 'vitest'
import { facturadoEnPeriodo, cobradoPorMedioEnPeriodo } from '@/lib/domain/metricas-facturacion'
import { inicioFinDeMes } from '@/lib/fechas'

describe('facturado en un período', () => {
  const enero = inicioFinDeMes('2026-01')

  it('suma solo las facturas emitidas dentro de la ventana', () => {
    const facturas = [
      { total: 100, emitida_en: '2026-01-05T10:00:00Z' },
      { total: 50, emitida_en: '2026-01-31T23:59:00Z' },
      { total: 999, emitida_en: '2026-02-01T00:00:00Z' }, // fuera: fin excluido
      { total: 999, emitida_en: '2025-12-31T23:00:00Z' }, // fuera: antes del inicio
    ]
    expect(facturadoEnPeriodo(facturas, enero)).toBe(150)
  })

  it('sin facturas da cero', () => {
    expect(facturadoEnPeriodo([], enero)).toBe(0)
  })
})

describe('cobrado por medio en un período', () => {
  const enero = inicioFinDeMes('2026-01')

  it('agrupa y suma por medio, ordenado de mayor a menor', () => {
    const pagos = [
      { medio: 'tarjeta', monto: 100, creado_en: '2026-01-10T00:00:00Z' },
      { medio: 'efectivo', monto: 30, creado_en: '2026-01-11T00:00:00Z' },
      { medio: 'tarjeta', monto: 50, creado_en: '2026-01-12T00:00:00Z' },
      { medio: 'efectivo', monto: 999, creado_en: '2026-02-01T00:00:00Z' }, // fuera de la ventana
    ]
    expect(cobradoPorMedioEnPeriodo(pagos, enero)).toEqual([
      { medio: 'tarjeta', monto: 150 },
      { medio: 'efectivo', monto: 30 },
    ])
  })

  it('sin pagos en la ventana da un arreglo vacío', () => {
    expect(cobradoPorMedioEnPeriodo([], enero)).toEqual([])
  })
})
