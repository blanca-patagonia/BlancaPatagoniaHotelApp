import { describe, it, expect } from 'vitest'
import { facturadoEnPeriodo, cobradoPorMedioEnPeriodo } from '@/lib/domain/metricas-facturacion'
import { inicioFinDeMes } from '@/lib/fechas'

describe('facturado en un período', () => {
  const enero = inicioFinDeMes('2026-01')

  it('suma solo las facturas emitidas dentro de la ventana', () => {
    // Los instantes llegan en UTC; el mes es el del HOTEL (UTC−3).
    const facturas = [
      { total: 100, emitida_en: '2026-01-05T10:00:00Z' },
      // 02:59 UTC del 1/2 = 23:59 del 31/1 en El Calafate: es de enero.
      { total: 50, emitida_en: '2026-02-01T02:59:00Z' },
      { total: 999, emitida_en: '2026-02-01T03:00:00Z' }, // 00:00 del 1/2 en el hotel: fuera
      { total: 999, emitida_en: '2026-01-01T02:00:00Z' }, // 23:00 del 31/12 en el hotel: fuera
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
      { medio: 'efectivo', monto: 999, creado_en: '2026-02-01T03:30:00Z' }, // 1/2 en el hotel: fuera
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

describe('el mes es el del hotel, no el de UTC', () => {
  it('lo cobrado el último día después de las 21:00 sigue siendo de ese mes', () => {
    const enero = inicioFinDeMes('2026-01')
    // 00:30 UTC del 1/2 = 21:30 del 31/1 en El Calafate. Antes caía en febrero.
    const pagos = [{ medio: 'efectivo', monto: 80, creado_en: '2026-02-01T00:30:00Z' }]
    expect(cobradoPorMedioEnPeriodo(pagos, enero)).toEqual([{ medio: 'efectivo', monto: 80 }])
  })
})
