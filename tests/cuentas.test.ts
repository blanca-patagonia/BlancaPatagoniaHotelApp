import { describe, it, expect } from 'vitest'
import { saldoCuenta, aplicarDescuento, type Movimiento } from '@/lib/domain/cuentas'

describe('saldoCuenta', () => {
  it('resta pagos de cargos', () => {
    const movs: Movimiento[] = [
      { tipo: 'cargo', monto: 642.51 },
      { tipo: 'cargo', monto: 300 },
      { tipo: 'pago', monto: 500 },
    ]
    expect(saldoCuenta(movs)).toBe(442.51)
  })

  it('una cuenta saldada da 0', () => {
    expect(saldoCuenta([{ tipo: 'cargo', monto: 500 }, { tipo: 'pago', monto: 500 }])).toBe(0)
  })

  it('un saldo a favor de la agencia es negativo', () => {
    expect(saldoCuenta([{ tipo: 'cargo', monto: 100 }, { tipo: 'pago', monto: 250 }])).toBe(-150)
  })
})

describe('aplicarDescuento', () => {
  it('aplica el porcentaje de descuento de la agencia', () => {
    expect(aplicarDescuento(1000, 15)).toBe(850)
    expect(aplicarDescuento(642.51, 0)).toBe(642.51)
  })
})
