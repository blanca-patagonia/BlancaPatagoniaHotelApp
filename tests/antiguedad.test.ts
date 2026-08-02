import { describe, it, expect } from 'vitest'
import {
  clasificarTramo,
  esDeudaViva,
  resumenAntiguedad,
  totalAdeudado,
  totalVencido,
  porVencer,
  type ComprobanteDeuda,
} from '@/lib/domain/antiguedad'

const HOY = '2026-08-02'

describe('clasificación por tramo', () => {
  it('lo que todavía no venció es corriente', () => {
    expect(clasificarTramo('2026-08-30', HOY)).toBe('corriente')
    expect(clasificarTramo(HOY, HOY)).toBe('corriente') // vence hoy: aún no está atrasado
  })

  it('sin fecha de vencimiento se considera corriente', () => {
    expect(clasificarTramo(null, HOY)).toBe('corriente')
    expect(clasificarTramo(undefined, HOY)).toBe('corriente')
  })

  it('ubica cada atraso en su tramo', () => {
    expect(clasificarTramo('2026-08-01', HOY)).toBe('d1_30')
    expect(clasificarTramo('2026-07-03', HOY)).toBe('d1_30')
    expect(clasificarTramo('2026-06-15', HOY)).toBe('d31_60')
    expect(clasificarTramo('2026-05-20', HOY)).toBe('d61_90')
    expect(clasificarTramo('2026-01-01', HOY)).toBe('d90_mas')
  })
})

describe('qué cuenta como deuda', () => {
  it('solo los cargos impagos', () => {
    expect(esDeudaViva({ tipo: 'cargo', estado: 'pendiente', monto: 100 })).toBe(true)
    expect(esDeudaViva({ tipo: 'cargo', estado: 'vencido', monto: 100 })).toBe(true)
  })

  it('un cargo pagado o anulado ya no es deuda', () => {
    expect(esDeudaViva({ tipo: 'cargo', estado: 'pagado', monto: 100 })).toBe(false)
    expect(esDeudaViva({ tipo: 'cargo', estado: 'anulado', monto: 100 })).toBe(false)
  })

  it('los pagos nunca son deuda', () => {
    expect(esDeudaViva({ tipo: 'pago', estado: 'pendiente', monto: 100 })).toBe(false)
  })
})

describe('reporte de antigüedad', () => {
  const comprobantes: ComprobanteDeuda[] = [
    { tipo: 'cargo', estado: 'pendiente', monto: 1000, vencimiento: '2026-08-20' }, // corriente
    { tipo: 'cargo', estado: 'vencido', monto: 500, vencimiento: '2026-07-20' }, // 13 días
    { tipo: 'cargo', estado: 'vencido', monto: 300, vencimiento: '2026-06-10' }, // 53 días
    { tipo: 'cargo', estado: 'vencido', monto: 200, vencimiento: '2026-01-05' }, // +90
    { tipo: 'cargo', estado: 'pagado', monto: 9999, vencimiento: '2026-01-05' }, // no cuenta
    { tipo: 'pago', estado: 'pagado', monto: 400 }, // no cuenta
  ]

  it('suma cada tramo por separado', () => {
    const r = resumenAntiguedad(comprobantes, HOY)
    expect(r.corriente).toBe(1000)
    expect(r.d1_30).toBe(500)
    expect(r.d31_60).toBe(300)
    expect(r.d61_90).toBe(0)
    expect(r.d90_mas).toBe(200)
  })

  it('ignora lo pagado y los pagos', () => {
    const r = resumenAntiguedad(comprobantes, HOY)
    expect(totalAdeudado(r)).toBe(2000) // 1000 + 500 + 300 + 200
  })

  it('separa lo vencido de lo corriente', () => {
    const r = resumenAntiguedad(comprobantes, HOY)
    expect(totalVencido(r)).toBe(1000) // todo menos el corriente
  })

  it('sin comprobantes da todo en cero', () => {
    const r = resumenAntiguedad([], HOY)
    expect(totalAdeudado(r)).toBe(0)
    expect(totalVencido(r)).toBe(0)
  })
})

describe('recordatorio de vencimientos', () => {
  const comprobantes = [
    { vencimiento: '2026-08-05' }, // en 3 días
    { vencimiento: '2026-08-20' }, // en 18 días
    { vencimiento: '2026-07-01' }, // ya vencido
    { vencimiento: null },
  ]

  it('lista lo que vence en la ventana', () => {
    expect(porVencer(comprobantes, HOY, 7)).toEqual([{ vencimiento: '2026-08-05' }])
  })

  it('no incluye lo ya vencido ni lo lejano', () => {
    const r = porVencer(comprobantes, HOY, 7)
    expect(r).toHaveLength(1)
  })

  it('con una ventana más amplia toma más comprobantes', () => {
    expect(porVencer(comprobantes, HOY, 30)).toHaveLength(2)
  })
})
