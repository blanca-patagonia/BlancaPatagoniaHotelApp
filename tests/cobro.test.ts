import { describe, it, expect } from 'vitest'
import {
  MEDIOS_DE_COBRO,
  MONEDA_BASE,
  calcularCobro,
  coincideElImporte,
  imputarEnUSD,
  linkVigente,
  medioDeCobro,
  motivoNoSeCobra,
  vencimientoDelLink,
  HORAS_VIGENCIA_LINK,
} from '@/lib/domain/cobro'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'

/**
 * Dominio del cobro en línea.
 *
 * El bloque que más importa es el primero: la invariante de que `pagos.monto`
 * está siempre en USD. Sin ella, cobrar en pesos salda la reserva al instante
 * y el huésped se va sin pagar.
 */

describe('calcularCobro · la invariante de la moneda', () => {
  it('en dólares no convierte nada y la cotización es 1', () => {
    const c = calcularCobro(145.2, 'USD', null)
    expect(c).toEqual({ monto: 145.2, moneda: 'USD', montoCobrado: 145.2, cotizacion: 1 })
  })

  it('en pesos, `monto` queda en USD y el importe cobrado en pesos', () => {
    const c = calcularCobro(100, 'ARS', 1450)!
    // Lo que salda la reserva sigue siendo 100 dólares…
    expect(c.monto).toBe(100)
    // …y lo que se le pide a la pasarela son 145.000 pesos.
    expect(c.montoCobrado).toBe(145000)
    expect(c.cotizacion).toBe(1450)
  })

  /*
    La demostración del bug que esto evita. Si el importe en pesos se guardara
    en `monto`, `resumenPagos` lo sumaría como si fueran dólares.
  */
  it('guardar el importe en pesos como `monto` saldaría la reserva sola', () => {
    const total = 100
    const bien = calcularCobro(total, 'ARS', 1450)!

    const correcto = resumenPagos(total, [
      { tipo: 'saldo', monto: bien.monto, estado: 'aprobado' },
    ] as Pago[])
    expect(correcto.saldada).toBe(true)
    expect(correcto.pagado).toBe(100)

    // El error: 145.000 sumados como dólares contra un total de 100.
    const mal = resumenPagos(total, [
      { tipo: 'saldo', monto: bien.montoCobrado, estado: 'aprobado' },
    ] as Pago[])
    expect(mal.pagado).toBe(145000)
    // Saldaría igual, pero con un pagado absurdo: el síntoma de la confusión.
    expect(mal.pagado).not.toBe(correcto.pagado)
  })

  it('sin cotización NO inventa un valor de respaldo', () => {
    // Cobrar a un tipo de cambio inventado es cobrarle de más o de menos a
    // alguien real. Corresponde no ofrecer la moneda.
    expect(calcularCobro(100, 'ARS', null)).toBeNull()
    expect(calcularCobro(100, 'ARS', 0)).toBeNull()
    expect(calcularCobro(100, 'ARS', -5)).toBeNull()
    expect(calcularCobro(100, 'ARS', Number.NaN)).toBeNull()
  })

  it('un importe que no es positivo se rechaza', () => {
    expect(calcularCobro(0, 'USD', null)).toBeNull()
    expect(calcularCobro(-10, 'USD', null)).toBeNull()
    expect(calcularCobro(Number.NaN, 'USD', null)).toBeNull()
  })

  it('redondea a dos decimales, como cualquier importe', () => {
    const c = calcularCobro(33.333, 'ARS', 1450.55)!
    expect(c.monto).toBe(33.33)
    expect(Number.isInteger(c.montoCobrado * 100)).toBe(true)
  })
})

describe('imputarEnUSD', () => {
  it('vuelve de la moneda de la pasarela a dólares', () => {
    expect(imputarEnUSD(145000, 1450)).toBe(100)
  })

  it('es la inversa de calcularCobro', () => {
    const c = calcularCobro(250, 'ARS', 1337.5)!
    expect(imputarEnUSD(c.montoCobrado, c.cotizacion)).toBe(250)
  })

  it('con valores imposibles devuelve null en vez de Infinity', () => {
    expect(imputarEnUSD(100, 0)).toBeNull()
    expect(imputarEnUSD(0, 1450)).toBeNull()
    expect(imputarEnUSD(Number.NaN, 1450)).toBeNull()
  })
})

describe('coincideElImporte · la defensa contra un link manipulado', () => {
  it('acepta el mismo importe, incluso escrito distinto', () => {
    expect(coincideElImporte(145.2, 145.2)).toBe(true)
    expect(coincideElImporte(145.2, 145.20001)).toBe(true)
    // El caso que rompía la versión por tolerancia: 0.1 + 0.2 no es 0.3.
    expect(coincideElImporte(0.1 + 0.2, 0.3)).toBe(true)
  })

  it('rechaza cualquier diferencia real, incluso de un centavo', () => {
    // La pasarela cobra exactamente lo que se le pidió: una diferencia es una
    // anomalía y hay que revisarla, no saldar la reserva.
    expect(coincideElImporte(145.2, 145.21)).toBe(false)
    expect(coincideElImporte(145.2, 145.5)).toBe(false)
    expect(coincideElImporte(1000, 1)).toBe(false)
    expect(coincideElImporte(100, 0)).toBe(false)
  })

  it('con valores no finitos no coincide', () => {
    expect(coincideElImporte(Number.NaN, 100)).toBe(false)
    expect(coincideElImporte(100, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('vigencia del link', () => {
  it('vence a las 48 horas', () => {
    const desde = new Date('2026-08-25T10:00:00Z')
    const vence = vencimientoDelLink(desde)
    expect(vence.getTime() - desde.getTime()).toBe(HORAS_VIGENCIA_LINK * 3600 * 1000)
  })

  it('un link dentro de la ventana sigue vivo', () => {
    const ahora = new Date('2026-08-25T10:00:00Z')
    expect(linkVigente('2026-08-26T10:00:00Z', ahora)).toBe(true)
  })

  it('un link pasado ya no sirve', () => {
    const ahora = new Date('2026-08-25T10:00:00Z')
    expect(linkVigente('2026-08-24T10:00:00Z', ahora)).toBe(false)
  })

  it('sin vencimiento se considera vivo, y una fecha rota también', () => {
    const ahora = new Date('2026-08-25T10:00:00Z')
    expect(linkVigente(null, ahora)).toBe(true)
    expect(linkVigente('no soy una fecha', ahora)).toBe(true)
  })
})

describe('motivoNoSeCobra', () => {
  it('con saldo y reserva viva, se puede cobrar', () => {
    expect(motivoNoSeCobra('confirmada', 100)).toBeNull()
    expect(motivoNoSeCobra('pendiente', 100)).toBeNull()
    expect(motivoNoSeCobra('in_house', 50)).toBeNull()
    // Un check-out con saldo pendiente sí se puede cobrar: la cuenta se cierra
    // con la factura, no con la salida.
    expect(motivoNoSeCobra('checkout', 25)).toBeNull()
  })

  it('sin saldo no hay nada que cobrar', () => {
    expect(motivoNoSeCobra('confirmada', 0)).toMatch(/no tiene saldo/i)
  })

  it('una reserva cancelada no se cobra desde acá', () => {
    expect(motivoNoSeCobra('cancelada', 100)).toMatch(/cancelada/i)
  })

  it('un no-show con saldo sí se puede cobrar', () => {
    // Es justamente el caso para el que existe la garantía: el hotel tiene
    // derecho a cobrar la penalidad del Tarifario.
    expect(motivoNoSeCobra('no_show', 100)).toBeNull()
  })
})

describe('catálogo de medios', () => {
  it('cubre lo que necesita un hotel internacional', () => {
    const ids = MEDIOS_DE_COBRO.map((m) => m.id)
    // Tarjeta internacional en dólares para el huésped del exterior…
    expect(ids).toContain('stripe')
    // …y pesos, cuotas, billetera y efectivo para el local.
    expect(ids).toContain('mercadopago')
  })

  it('MercadoPago cobra en pesos y Stripe en dólares', () => {
    expect(medioDeCobro('mercadopago')!.moneda).toBe('ARS')
    expect(medioDeCobro('stripe')!.moneda).toBe(MONEDA_BASE)
  })

  it('el medio local ofrece efectivo, que ninguna pasarela internacional cubre', () => {
    const formas = medioDeCobro('mercadopago')!.formas.join(' ').toLowerCase()
    expect(formas).toMatch(/efectivo/)
    expect(formas).toMatch(/débito|debito/)
  })

  it('un id que no existe devuelve null', () => {
    expect(medioDeCobro('paypal')).toBeNull()
  })
})
