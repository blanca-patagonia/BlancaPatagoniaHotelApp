import { describe, it, expect } from 'vitest'
import {
  costoAdquisicion,
  desvioDeComision,
  metricasPorCanal,
  totalesDeCanales,
  type ReservaDeMetrica,
} from '@/lib/domain/metricas-canal'

function reserva(over: Partial<ReservaDeMetrica> = {}): ReservaDeMetrica {
  return { canal: 'booking', total: 450, comision: 67.5, noches: 3, ...over }
}

describe('métricas por canal · el neto', () => {
  it('neto = bruto − comisión', () => {
    const [m] = metricasPorCanal([reserva()])
    expect(m.bruto).toBe(450)
    expect(m.comision).toBe(67.5)
    expect(m.neto).toBe(382.5)
  })

  it('agrupa por canal y suma', () => {
    const r = metricasPorCanal([
      reserva({ canal: 'booking', total: 450, comision: 67.5 }),
      reserva({ canal: 'booking', total: 300, comision: 45 }),
      reserva({ canal: 'directo', total: 500, comision: null }),
    ])

    expect(r).toHaveLength(2)
    const booking = r.find((m) => m.canal === 'booking')!
    expect(booking.reservas).toBe(2)
    expect(booking.bruto).toBe(750)
    expect(booking.neto).toBe(637.5)
  })

  it('ordena por NETO, no por bruto', () => {
    /*
      El caso que justifica el criterio: un canal factura más pero se lleva una comisión
      que lo deja abajo. Ordenar por bruto pondría primero al que menos plata deja, que
      es exactamente la confusión que este módulo viene a deshacer.
    */
    const r = metricasPorCanal([
      reserva({ canal: 'booking', total: 1000, comision: 400 }), // neto 600
      reserva({ canal: 'directo', total: 800, comision: 0 }), // neto 800
    ])

    expect(r[0].canal).toBe('directo')
    expect(r[0].neto).toBe(800)
    expect(r[1].canal).toBe('booking')
  })
})

describe('métricas por canal · comisión no informada', () => {
  it('una reserva sin comisión NO cuenta como comisión cero', () => {
    // Sumarla como cero afirmaría que el canal no cobró nada por esa reserva, y es
    // falso. El feed iCal nunca informa comisión: es el caso normal, no la excepción.
    const [m] = metricasPorCanal([
      reserva({ total: 450, comision: 67.5 }),
      reserva({ total: 300, comision: null }),
    ])

    expect(m.bruto).toBe(750)
    // La comisión suma SOLO la informada.
    expect(m.comision).toBe(67.5)
    expect(m.sinComisionInformada).toBe(1)
  })

  it('el total marca el reporte como incompleto', () => {
    // Es la diferencia entre «el neto es 682,50» y «es al menos 682,50 y falta una».
    const t = totalesDeCanales(
      metricasPorCanal([reserva({ comision: 67.5 }), reserva({ comision: null })]),
    )
    expect(t.incompleto).toBe(true)
    expect(t.sinComisionInformada).toBe(1)
  })

  it('con todas informadas el total NO está incompleto', () => {
    const t = totalesDeCanales(metricasPorCanal([reserva(), reserva()]))
    expect(t.incompleto).toBe(false)
    expect(t.sinComisionInformada).toBe(0)
  })
})

describe('métricas por canal · ADR', () => {
  it('calcula el ADR bruto y el neto, y el neto es menor', () => {
    // La comparación es el punto: lo que paga el huésped por noche contra lo que le
    // queda al hotel.
    const [m] = metricasPorCanal([reserva({ total: 450, comision: 67.5, noches: 3 })])
    expect(m.adrBruto).toBe(150)
    expect(m.adrNeto).toBe(127.5)
    expect(m.adrNeto!).toBeLessThan(m.adrBruto!)
  })

  it('sin noches el ADR es null, NO cero', () => {
    // Dividir por cero no da «cero pesos por noche»: da un dato que no existe.
    const [m] = metricasPorCanal([reserva({ noches: 0 })])
    expect(m.adrBruto).toBeNull()
    expect(m.adrNeto).toBeNull()
  })
})

describe('métricas por canal · comisión efectiva', () => {
  it('revela el porcentaje real que cobra el canal', () => {
    const [m] = metricasPorCanal([reserva({ total: 1000, comision: 180 })])
    expect(m.comisionPct).toBe(18)
  })

  it('con bruto cero devuelve null, no cero por ciento', () => {
    const [m] = metricasPorCanal([reserva({ total: 0, comision: 0 })])
    expect(m.comisionPct).toBeNull()
  })
})

describe('métricas por canal · costo de adquisición', () => {
  it('reparte la comisión entre las reservas del canal', () => {
    const [m] = metricasPorCanal([
      reserva({ total: 450, comision: 60 }),
      reserva({ total: 300, comision: 40 }),
    ])
    expect(costoAdquisicion(m)).toBe(50)
  })

  it('EL CASO CLAVE: un canal sin comisión devuelve null, NUNCA cero', () => {
    /*
      Para `directo` y `web` el costo NO es cero: hay Google Ads y tiempo de mostrador.
      Lo que pasa es que el sistema no los conoce, y eso es distinto de que no existan.

      Mostrar «USD 0» haría que la comparación diga «el directo es gratis», que es la
      conclusión equivocada más cara que este reporte podría inducir: llevaría a bajar
      la inversión en los canales pagos sin saber qué cuesta el propio.
    */
    const [m] = metricasPorCanal([reserva({ canal: 'directo', comision: null })])
    expect(costoAdquisicion(m)).toBeNull()
    expect(costoAdquisicion(m)).not.toBe(0)
  })

  it('un canal sin reservas devuelve null', () => {
    expect(
      costoAdquisicion({
        canal: 'x',
        reservas: 0,
        noches: 0,
        bruto: 0,
        comision: 0,
        neto: 0,
        comisionPct: null,
        adrBruto: null,
        adrNeto: null,
        sinComisionInformada: 0,
      }),
    ).toBeNull()
  })
})

describe('métricas por canal · desvío de la comisión pactada', () => {
  it('avisa cuando el canal cobra más de lo acordado', () => {
    // 18 % efectivo contra 15 % pactado son tres puntos que nadie estaba mirando.
    expect(desvioDeComision(18, 15)).toBe(3)
  })

  it('avisa también cuando cobra de menos', () => {
    expect(desvioDeComision(12, 15)).toBe(-3)
  })

  it('no avisa por décimas de redondeo', () => {
    // El redondeo por reserva no da nunca el porcentaje exacto: avisar por dos décimas
    // sería ruido, y el ruido hace que nadie mire el aviso.
    expect(desvioDeComision(15.3, 15)).toBeNull()
  })

  it('sin porcentaje pactado no hay con qué comparar', () => {
    expect(desvioDeComision(18, null)).toBeNull()
    expect(desvioDeComision(18, undefined)).toBeNull()
  })

  it('sin comisión efectiva tampoco', () => {
    expect(desvioDeComision(null, 15)).toBeNull()
  })
})

describe('métricas por canal · totales', () => {
  it('consolida todos los canales', () => {
    const t = totalesDeCanales(
      metricasPorCanal([
        reserva({ canal: 'booking', total: 450, comision: 67.5 }),
        reserva({ canal: 'directo', total: 500, comision: 0 }),
      ]),
    )
    expect(t.bruto).toBe(950)
    expect(t.comision).toBe(67.5)
    expect(t.neto).toBe(882.5)
    expect(t.reservas).toBe(2)
  })

  it('una lista vacía no rompe', () => {
    const t = totalesDeCanales([])
    expect(t.bruto).toBe(0)
    expect(t.neto).toBe(0)
    expect(t.incompleto).toBe(false)
  })
})
