import { describe, it, expect } from 'vitest'
import { resumenPagos, seniaSugerida, type Pago } from '@/lib/domain/pagos'

describe('resumenPagos', () => {
  it('suma seña y saldo aprobados', () => {
    const pagos: Pago[] = [
      { tipo: 'senia', monto: 214.17, estado: 'aprobado' },
      { tipo: 'saldo', monto: 428.34, estado: 'aprobado' },
    ]
    const r = resumenPagos(642.51, pagos)
    expect(r.pagado).toBe(642.51)
    expect(r.saldo).toBe(0)
    expect(r.saldada).toBe(true)
    expect(r.tieneSenia).toBe(true)
  })

  it('ignora pagos no aprobados y calcula el saldo', () => {
    const pagos: Pago[] = [
      { tipo: 'senia', monto: 214.17, estado: 'aprobado' },
      { tipo: 'saldo', monto: 100, estado: 'pendiente' },
    ]
    const r = resumenPagos(642.51, pagos)
    expect(r.pagado).toBe(214.17)
    expect(r.saldo).toBe(428.34)
    expect(r.saldada).toBe(false)
    expect(r.tieneSenia).toBe(true)
  })

  it('los reembolsos descuentan de lo pagado', () => {
    const pagos: Pago[] = [
      { tipo: 'saldo', monto: 500, estado: 'aprobado' },
      { tipo: 'reembolso', monto: 200, estado: 'aprobado' },
    ]
    const r = resumenPagos(642.51, pagos)
    expect(r.pagado).toBe(300)
    expect(r.saldada).toBe(false)
  })

  it('una reserva sin pagos no está saldada', () => {
    const r = resumenPagos(642.51, [])
    expect(r.pagado).toBe(0)
    expect(r.saldo).toBe(642.51)
    expect(r.saldada).toBe(false)
    expect(r.tieneSenia).toBe(false)
  })
})

describe('seniaSugerida', () => {
  it('es la primera noche (total / noches)', () => {
    expect(seniaSugerida(642.51, 3)).toBe(214.17)
  })
})
