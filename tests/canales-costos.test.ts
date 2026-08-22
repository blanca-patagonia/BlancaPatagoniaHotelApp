import { describe, it, expect } from 'vitest'
import {
  claveDeCargo,
  comisionEfectivaPct,
  conciliarDevengoContraFactura,
  devengarComision,
  netoDeComision,
  netoDelPeriodo,
  CONCEPTOS_CARGO,
  ORIGENES_CARGO,
  ETIQUETAS_CONCEPTO,
  ETIQUETAS_ORIGEN,
  ETIQUETAS_CONCILIACION,
  ESTADOS_CONCILIACION,
} from '@/lib/domain/canales-costos'

describe('costos de canal · devengo de la comisión', () => {
  const base = {
    comision: 67.5,
    monedaCanal: 'USD',
    operacion: 'nueva' as const,
    externalId: '4123456789',
  }

  it('devenga la comisión que informó el canal', () => {
    const cargo = devengarComision(base)
    expect(cargo).not.toBeNull()
    expect(cargo!.concepto).toBe('comision')
    expect(cargo!.origen).toBe('informe_reservas')
    expect(cargo!.monto).toBe(67.5)
    expect(cargo!.moneda).toBe('USD')
  })

  it('NO devenga si el canal no informó comisión', () => {
    // El feed iCal nunca la trae. Devengar cero afirmaría que Booking no cobró
    // nada, que es falso; sin devengar, la reserva queda contada como «sin informar».
    expect(devengarComision({ ...base, comision: null })).toBeNull()
    expect(devengarComision({ ...base, comision: undefined })).toBeNull()
  })

  it('NO devenga una comisión de cero ni negativa', () => {
    expect(devengarComision({ ...base, comision: 0 })).toBeNull()
    expect(devengarComision({ ...base, comision: -5 })).toBeNull()
  })

  it('NO devenga la comisión de una reserva cancelada', () => {
    // La comisión de una cancelada la define la política del canal y puede ser cero,
    // parcial o total. No se adivina: si la factura la cobra, entra por
    // `factura_comision` y aparece como «línea de factura sin devengo».
    expect(devengarComision({ ...base, operacion: 'cancelada' })).toBeNull()
  })

  it('sí devenga la de una modificada', () => {
    expect(devengarComision({ ...base, operacion: 'modificada' })).not.toBeNull()
  })

  it('cae en USD si el canal no informó la moneda', () => {
    expect(devengarComision({ ...base, monedaCanal: '' })!.moneda).toBe('USD')
  })

  it('redondea a dos decimales', () => {
    expect(devengarComision({ ...base, comision: 67.499999 })!.monto).toBe(67.5)
  })
})

describe('costos de canal · clave de idempotencia', () => {
  it('el origen forma parte de la clave', () => {
    // Es la decisión central del módulo: la comisión que informó el archivo de
    // reservas y la que cobró la factura mensual son DOS filas que tienen que poder
    // convivir. Si compartieran clave, la segunda pisaría a la primera y la
    // conciliación —que es todo el punto— sería imposible.
    const delInforme = claveDeCargo('informe_reservas', 'comision', 'R-1')
    const deLaFactura = claveDeCargo('factura_comision', 'comision', 'R-1')
    expect(delInforme).not.toBe(deLaFactura)
  })

  it('la misma fuente y la misma reserva dan la misma clave', () => {
    expect(claveDeCargo('informe_reservas', 'comision', 'R-1')).toBe(
      claveDeCargo('informe_reservas', 'comision', 'R-1'),
    )
  })

  it('distingue conceptos sobre la misma reserva', () => {
    expect(claveDeCargo('liquidacion', 'comision', 'R-1')).not.toBe(
      claveDeCargo('liquidacion', 'payout', 'R-1'),
    )
  })
})

describe('costos de canal · neto de comisión', () => {
  it('resta la comisión del total', () => {
    expect(netoDeComision(450, 67.5)).toBe(382.5)
  })

  it('sin comisión informada devuelve el total intacto', () => {
    // Es lo correcto acá: la función responde «cuánto queda», y sin dato de comisión
    // lo que se sabe es el total. Quien tenga que distinguir «sin comisión» de
    // «comisión cero» usa `netoDelPeriodo`, que las cuenta aparte.
    expect(netoDeComision(450, null)).toBe(450)
    expect(netoDeComision(450, undefined)).toBe(450)
  })

  it('redondea a dos decimales', () => {
    expect(netoDeComision(100.005, 0.005)).toBe(100)
  })
})

describe('costos de canal · comisión efectiva', () => {
  it('calcula el porcentaje sobre el bruto', () => {
    expect(comisionEfectivaPct(450, 67.5)).toBe(15)
  })

  it('revela cuando el canal cobra más que lo pactado', () => {
    // 18 % contra un 15 % acordado son tres puntos que nadie estaba mirando.
    expect(comisionEfectivaPct(1000, 180)).toBe(18)
  })

  it('devuelve null y NO cero con bruto cero o negativo', () => {
    // Un denominador inválido no es «comisión del cero por ciento». Mostrar 0 %
    // haría creer que el canal no cobra nada.
    expect(comisionEfectivaPct(0, 50)).toBeNull()
    expect(comisionEfectivaPct(-100, 50)).toBeNull()
  })
})

describe('costos de canal · conciliación contra la factura', () => {
  it('cierra cuando devengado y facturado coinciden', () => {
    const r = conciliarDevengoContraFactura(1243.5, 1243.5)
    expect(r.cierra).toBe(true)
    expect(r.diferencia).toBe(0)
    expect(r.detalle).toBe('')
  })

  it('cierra dentro de la tolerancia de redondeo', () => {
    // La tolerancia es la de `detectarDiscrepancia`: absorbe el redondeo de
    // conversión de moneda. Por debajo de eso no vale molestar a nadie.
    expect(conciliarDevengoContraFactura(1243.5, 1243.8).cierra).toBe(true)
  })

  it('no cierra y explica cuando el canal factura de más', () => {
    const r = conciliarDevengoContraFactura(1243.5, 1251)
    expect(r.cierra).toBe(false)
    expect(r.diferencia).toBeCloseTo(7.5, 2)
    expect(r.detalle).toContain('7.50')
    expect(r.detalle).toContain('1243.50')
    expect(r.detalle).toContain('1251.00')
  })

  it('la diferencia es POSITIVA cuando el canal factura más de lo devengado', () => {
    // El signo importa y es fácil invertirlo: `detectarDiscrepancia(propio, canal)`
    // toma lo devengado como «propio». Positivo = el canal cobra más que lo nuestro,
    // que es el caso que hay que reclamar.
    expect(conciliarDevengoContraFactura(100, 120).diferencia).toBeGreaterThan(0)
    expect(conciliarDevengoContraFactura(120, 100).diferencia).toBeLessThan(0)
  })
})

describe('costos de canal · neto del período', () => {
  it('consolida bruto, comisión y neto', () => {
    const r = netoDelPeriodo([
      { total: 450, comision: 67.5 },
      { total: 300, comision: 45 },
    ])
    expect(r.bruto).toBe(750)
    expect(r.comision).toBe(112.5)
    expect(r.neto).toBe(637.5)
    expect(r.comisionPct).toBe(15)
    expect(r.reservas).toBe(2)
    expect(r.sinComisionInformada).toBe(0)
  })

  it('las reservas SIN comisión informada se cuentan aparte, no como cero', () => {
    // Es la diferencia entre «el neto es 750» y «el neto es al menos 750 y faltan 2
    // por informar». Presentar lo primero como definitivo es el mismo error que
    // sumar cero.
    const r = netoDelPeriodo([
      { total: 450, comision: 67.5 },
      { total: 300, comision: null },
      { total: 200, comision: undefined },
    ])
    expect(r.reservas).toBe(3)
    expect(r.sinComisionInformada).toBe(2)
    expect(r.bruto).toBe(950)
    // La comisión suma SOLO la informada: no se inventa la de las otras dos.
    expect(r.comision).toBe(67.5)
  })

  it('un período vacío no divide por cero', () => {
    const r = netoDelPeriodo([])
    expect(r.bruto).toBe(0)
    expect(r.neto).toBe(0)
    expect(r.comisionPct).toBeNull()
    expect(r.reservas).toBe(0)
  })

  it('un período sin ninguna comisión informada da porcentaje 0, no null', () => {
    // El bruto es válido, así que el porcentaje es calculable: es 0 porque no hay
    // comisión sumada. Lo que avisa que el número está incompleto es
    // `sinComisionInformada`, no el porcentaje.
    const r = netoDelPeriodo([{ total: 500, comision: null }])
    expect(r.comisionPct).toBe(0)
    expect(r.sinComisionInformada).toBe(1)
  })
})

describe('costos de canal · los catálogos están completos', () => {
  it('cada concepto, origen y estado tiene etiqueta en español', () => {
    // Sin esto, agregar un valor a la unión y olvidar la etiqueta deja la pantalla
    // mostrando el identificador crudo.
    for (const c of CONCEPTOS_CARGO) expect(ETIQUETAS_CONCEPTO[c]).toBeTruthy()
    for (const o of ORIGENES_CARGO) expect(ETIQUETAS_ORIGEN[o]).toBeTruthy()
    for (const e of ESTADOS_CONCILIACION) expect(ETIQUETAS_CONCILIACION[e]).toBeTruthy()
  })
})
