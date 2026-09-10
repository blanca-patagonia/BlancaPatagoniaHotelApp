import { describe, it, expect } from 'vitest'
import { resumenMovimientos, totalPorMedio, type MovimientoDelDia } from '@/lib/domain/cierre-diario'
import { MEDIOS_PAGO } from '@/lib/domain/pagos'

describe('resumenMovimientos', () => {
  it('cuenta llegadas efectivas contra previstas', () => {
    const movs: MovimientoDelDia[] = [
      { tipo: 'llegada', estado: 'in_house' },
      { tipo: 'llegada', estado: 'checkout' },
      { tipo: 'llegada', estado: 'confirmada' },
    ]
    const r = resumenMovimientos(movs)
    expect(r.llegadasPrevistas).toBe(3)
    expect(r.llegadasEfectivas).toBe(2)
    expect(r.noShows).toBe(0)
  })

  it('distingue un no-show de una llegada pendiente', () => {
    const movs: MovimientoDelDia[] = [
      { tipo: 'llegada', estado: 'no_show' },
      { tipo: 'llegada', estado: 'confirmada' },
    ]
    const r = resumenMovimientos(movs)
    expect(r.noShows).toBe(1)
    expect(r.llegadasEfectivas).toBe(0)
  })

  it('cuenta salidas efectivas solo cuando hizo checkout', () => {
    const movs: MovimientoDelDia[] = [
      { tipo: 'salida', estado: 'checkout' },
      { tipo: 'salida', estado: 'in_house' },
    ]
    const r = resumenMovimientos(movs)
    expect(r.salidasPrevistas).toBe(2)
    expect(r.salidasEfectivas).toBe(1)
  })

  it('una lista vacía da todo en cero', () => {
    const r = resumenMovimientos([])
    expect(r).toEqual({
      llegadasPrevistas: 0,
      llegadasEfectivas: 0,
      noShows: 0,
      salidasPrevistas: 0,
      salidasEfectivas: 0,
    })
  })
})

describe('totalPorMedio', () => {
  it('suma por medio y deja en cero los que no tuvieron movimiento', () => {
    const totales = totalPorMedio(
      [
        { medio: 'efectivo', monto: 100 },
        { medio: 'efectivo', monto: 50 },
        { medio: 'tarjeta', monto: 200 },
      ],
      MEDIOS_PAGO,
    )
    expect(totales.efectivo).toBe(150)
    expect(totales.tarjeta).toBe(200)
    expect(totales.transferencia).toBe(0)
    expect(Object.keys(totales)).toHaveLength(MEDIOS_PAGO.length)
  })
})
