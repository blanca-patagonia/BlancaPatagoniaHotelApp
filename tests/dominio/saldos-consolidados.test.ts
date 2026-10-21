import { describe, it, expect } from 'vitest'
import { pagadoPorReserva, primerCheckIn } from '@/lib/domain/cuentas'
import { resumenDeCuenta, resumenPagos, type Pago } from '@/lib/domain/pagos'
import { totalAcreditado, saldoAcreditable } from '@/lib/domain/facturacion'

/*
  Reglas de plata que estaban copiadas en varias pantallas (ficha de agencia,
  portal del socio, ficha de reserva, listado, CSV, factura) y pasaron al
  dominio para que no puedan divergir.
*/

describe('pagadoPorReserva', () => {
  it('suma sólo los pagos, separados por reserva', () => {
    const pagado = pagadoPorReserva([
      { tipo: 'pago', monto: 100, reserva_id: 'a' },
      { tipo: 'pago', monto: '50.25', reserva_id: 'a' },
      { tipo: 'pago', monto: 30, reserva_id: 'b' },
      { tipo: 'cargo', monto: 999, reserva_id: 'a' },
    ])
    expect(pagado.get('a')).toBe(150.25)
    expect(pagado.get('b')).toBe(30)
  })

  it('ignora los pagos que no están atados a una reserva', () => {
    const pagado = pagadoPorReserva([{ tipo: 'pago', monto: 500, reserva_id: null }])
    expect(pagado.size).toBe(0)
  })

  it('redondea a centavos y no arrastra el error de coma flotante', () => {
    const pagado = pagadoPorReserva([
      { tipo: 'pago', monto: 0.1, reserva_id: 'a' },
      { tipo: 'pago', monto: 0.2, reserva_id: 'a' },
    ])
    expect(pagado.get('a')).toBe(0.3)
  })
})

describe('primerCheckIn', () => {
  it('toma el check-in más temprano de todas las estadías', () => {
    expect(primerCheckIn(['[2026-12-10,2026-12-12)', '[2026-12-05,2026-12-10)'])).toBe('2026-12-05')
  })

  it('sin estadías no hay check-in', () => {
    expect(primerCheckIn([])).toBeNull()
  })
})

describe('resumenDeCuenta', () => {
  const pagos: Pago[] = [{ tipo: 'senia', monto: 300, estado: 'aprobado' }]

  it('mide el saldo contra alojamiento MÁS consumos', () => {
    const r = resumenDeCuenta(300, [{ cantidad: 2, precioUnitario: 12 }], pagos)
    expect(r.saldo).toBe(24)
    expect(r.saldada).toBe(false)
  })

  it('es el bug que corrige: contra el alojamiento solo daba saldada', () => {
    expect(resumenPagos(300, pagos).saldada).toBe(true)
    expect(resumenDeCuenta(300, [{ cantidad: 1, precioUnitario: 5 }], pagos).saldada).toBe(false)
  })

  it('sin consumos coincide con resumenPagos', () => {
    expect(resumenDeCuenta(300, [], pagos)).toEqual(resumenPagos(300, pagos))
  })
})

describe('totalAcreditado', () => {
  it('suma las notas de crédito, vengan como número o como texto', () => {
    expect(totalAcreditado([{ total: 100 }, { total: '50.5' }])).toBe(150.5)
  })

  it('sin notas no hay nada acreditado', () => {
    expect(totalAcreditado([])).toBe(0)
  })

  it('combinado con saldoAcreditable da lo que queda por acreditar', () => {
    expect(saldoAcreditable(363, totalAcreditado([{ total: 0.1 }, { total: 0.2 }]))).toBe(362.7)
  })
})
