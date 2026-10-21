import { describe, it, expect } from 'vitest'
import {
  saldoCuenta,
  aplicarDescuento,
  movimientoEnMoneda,
  type Movimiento,
} from '@/lib/domain/cuentas'

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

/**
 * Moneda del movimiento (auditoría 2026-09, P1-3; migración 0078).
 *
 * El defecto que cierra: `movimientos_cuenta` y `movimientos_proveedor` tenían
 * columna `moneda` desde el primer día y **ninguna acción la escribía**, así que
 * todas las filas decían USD. Una factura de lavandería de ARS 185.000 entraba
 * como una deuda de USD 185.000.
 */
describe('movimientoEnMoneda', () => {
  it('en dólares no hay conversión ni detalle que guardar', () => {
    expect(movimientoEnMoneda(642.51, 'USD', null)).toEqual({
      monto: 642.51,
      moneda: 'USD',
      montoOrigen: null,
      cotizacion: null,
    })
  })

  it('en pesos guarda las dos cosas: el saldo en USD y el papel en pesos', () => {
    const m = movimientoEnMoneda(185_000, 'ARS', 1480)

    expect(m?.monto, 'el saldo vive en dólares').toBe(125)
    expect(m?.montoOrigen, 'lo que dice la factura del proveedor').toBe(185_000)
    expect(m?.cotizacion).toBe(1480)
  })

  it('divide por la cotización, no multiplica', () => {
    /*
      Es la dirección contraria a `calcularCobro` (lib/domain/cobro.ts), que parte
      de un saldo en USD para pedirle a la pasarela un importe en pesos. Invertirla
      convertiría una factura de ARS 185.000 en una deuda de USD 273.800.000.
    */
    const m = movimientoEnMoneda(185_000, 'ARS', 1480)
    expect(m!.monto).toBeLessThan(185_000)
  })

  it('sin cotización NO inventa una', () => {
    // Un tipo de cambio inventado mueve el saldo de un socio real, y esa
    // diferencia después la discute alguien.
    expect(movimientoEnMoneda(185_000, 'ARS', null)).toBeNull()
    expect(movimientoEnMoneda(185_000, 'ARS', 0)).toBeNull()
  })

  it('rechaza importes que no son importes', () => {
    expect(movimientoEnMoneda(0, 'USD', null)).toBeNull()
    expect(movimientoEnMoneda(-100, 'USD', null)).toBeNull()
    expect(movimientoEnMoneda(Number.NaN, 'USD', null)).toBeNull()
  })

  it('rechaza un importe que redondearía a cero dólares', () => {
    // Entraría como un movimiento de USD 0,00 y la base lo rechazaría con un error
    // de restricción ilegible.
    expect(movimientoEnMoneda(1, 'ARS', 1_000_000)).toBeNull()
  })
})
