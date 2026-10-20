import { describe, it, expect } from 'vitest'
import {
  claveDeMovimiento,
  coincidenciaAutomatica,
  conClaves,
  DIAS_TOLERANCIA,
  egresosPorConcepto,
  emparejar,
  gastosPorMes,
  resumirConcepto,
  type MovimientoExterno,
  type PagoConciliable,
} from '@/lib/domain/conciliacion'

/**
 * Conciliación bancaria y de pasarelas (Bloque C, objetivos 4 y 10).
 *
 * Todo acá es lógica pura: se prueba sin base y sin red.
 */

describe('clave de idempotencia de un movimiento', () => {
  const base = { fecha: '2026-09-05', monto: -3500, descripcion: 'COMPRA TARJ DEB ANONIMA' }

  it('el mismo movimiento da la misma clave', () => {
    // Es lo que hace que reimportar el mismo extracto no duplique nada.
    expect(claveDeMovimiento(base, 1)).toBe(claveDeMovimiento({ ...base }, 1))
  })

  it('no se deja confundir por espacios ni mayúsculas', () => {
    // El mismo archivo exportado dos veces puede traer espacios de más.
    expect(claveDeMovimiento({ ...base, descripcion: '  compra   tarj deb  ANONIMA ' }, 1)).toBe(
      claveDeMovimiento(base, 1),
    )
  })

  it('un importe distinto da otra clave', () => {
    expect(claveDeMovimiento({ ...base, monto: -3501 }, 1)).not.toBe(claveDeMovimiento(base, 1))
  })

  it('el ordinal distingue dos movimientos idénticos', () => {
    // Dos cafés de $3.500 el mismo día son dos movimientos reales.
    expect(claveDeMovimiento(base, 2)).not.toBe(claveDeMovimiento(base, 1))
  })
})

describe('conClaves', () => {
  const uno = { origen: 'banco' as const, fecha: '2026-09-05', descripcion: 'CAFE', monto: -3500, moneda: 'ARS' }

  it('dos movimientos idénticos NO se pisan', () => {
    /*
      El caso que justifica el ordinal.

      Sin él, la segunda ocurrencia chocaría contra el `unique (origen, external_id)`
      de la base y se perdería en silencio: el mes cerraría $3.500 de menos y nada
      lo avisaría.
    */
    const salida = conClaves([uno, { ...uno }])

    expect(salida).toHaveLength(2)
    expect(salida[0].externalId).not.toBe(salida[1].externalId)
  })

  it('el mismo archivo importado dos veces da las mismas claves', () => {
    const primera = conClaves([uno, { ...uno }, { ...uno, monto: -900 }])
    const segunda = conClaves([uno, { ...uno }, { ...uno, monto: -900 }])

    expect(segunda.map((m) => m.externalId)).toEqual(primera.map((m) => m.externalId))
  })

  it('si la fuente trae su propio id, ése gana', () => {
    // El id del banco o de la pasarela siempre es mejor que uno derivado.
    const salida = conClaves([uno, { ...uno }], ['OP-991', null])

    expect(salida[0].externalId).toBe('OP-991')
    expect(salida[1].externalId).toContain('2026-09-05')
  })
})

describe('emparejar un movimiento contra los pagos', () => {
  const pagos: PagoConciliable[] = [
    { id: 'p1', externalId: 'mp-123', fecha: '2026-09-03', monto: 148_000, moneda: 'ARS' },
    { id: 'p2', externalId: 'mp-456', fecha: '2026-09-03', monto: 148_000, moneda: 'ARS' },
    { id: 'p3', externalId: null, fecha: '2026-06-01', monto: 148_000, moneda: 'ARS' },
    { id: 'p4', externalId: null, fecha: '2026-09-04', monto: 100, moneda: 'USD' },
  ]

  const movimiento = {
    externalId: 'mp-123',
    fecha: '2026-09-05',
    monto: 148_000,
    moneda: 'ARS',
  }

  it('la referencia de la pasarela gana y es exacta', () => {
    const [primero] = emparejar(movimiento, pagos)
    expect(primero.pagoId).toBe('p1')
    expect(primero.motivo).toBe('referencia')
    expect(primero.confianza).toBe('exacta')
  })

  it('el importe y la fecha solo dan un candidato PROBABLE', () => {
    const candidatos = emparejar({ ...movimiento, externalId: 'sin-referencia' }, pagos)

    expect(candidatos.every((c) => c.confianza === 'probable')).toBe(true)
    // p1 y p2 coinciden en importe y fecha; p3 está fuera de la ventana y p4 es
    // otra moneda.
    expect(candidatos.map((c) => c.pagoId).sort()).toEqual(['p1', 'p2'])
  })

  it('no cruza monedas', () => {
    // Sumar 100 dólares contra 100 pesos es el error más caro posible acá.
    const candidatos = emparejar(
      { externalId: 'x', fecha: '2026-09-05', monto: 100, moneda: 'ARS' },
      pagos,
    )
    expect(candidatos.map((c) => c.pagoId)).not.toContain('p4')
  })

  it('respeta la ventana de tolerancia', () => {
    const dentro = emparejar({ ...movimiento, externalId: 'x', fecha: '2026-09-08' }, pagos)
    const fuera = emparejar({ ...movimiento, externalId: 'x', fecha: '2026-09-09' }, pagos)

    expect(DIAS_TOLERANCIA).toBe(5)
    expect(dentro.length).toBeGreaterThan(0)
    expect(fuera).toHaveLength(0)
  })

  it('un egreso no se empareja contra ningún cobro', () => {
    // `pagos` es lo que el hotel COBRA. Ofrecer casar un gasto con un cobro sería
    // ofrecer un error.
    expect(emparejar({ ...movimiento, monto: -148_000 }, pagos)).toHaveLength(0)
  })
})

describe('qué se puede conciliar solo', () => {
  it('una referencia única, sí', () => {
    const candidato = coincidenciaAutomatica([
      { pagoId: 'p1', motivo: 'referencia', confianza: 'exacta', diasDeDiferencia: 2 },
      { pagoId: 'p2', motivo: 'importe_y_fecha', confianza: 'probable', diasDeDiferencia: 0 },
    ])
    expect(candidato?.pagoId).toBe('p1')
  })

  it('el importe y la fecha, NUNCA', () => {
    /*
      La regla central de todo el módulo.

      Dos huéspedes que pagan la misma seña el mismo día es lo más común del mundo.
      Casar el cobro con la reserva equivocada deja a uno figurando impago y al
      otro pagado sin haber pagado, y eso no lo revisa nadie después.
    */
    expect(
      coincidenciaAutomatica([
        { pagoId: 'p1', motivo: 'importe_y_fecha', confianza: 'probable', diasDeDiferencia: 0 },
      ]),
    ).toBeNull()
  })

  it('dos referencias iguales tampoco: elegiría al azar', () => {
    expect(
      coincidenciaAutomatica([
        { pagoId: 'p1', motivo: 'referencia', confianza: 'exacta', diasDeDiferencia: 0 },
        { pagoId: 'p2', motivo: 'referencia', confianza: 'exacta', diasDeDiferencia: 1 },
      ]),
    ).toBeNull()
  })
})

describe('gastos por mes', () => {
  const movimientos = [
    { fecha: '2026-09-05', monto: -120_000 },
    { fecha: '2026-09-20', monto: -80_000 },
    { fecha: '2026-09-22', monto: 500_000 },
    { fecha: '2026-08-11', monto: -60_000 },
  ]

  it('separa lo que entró de lo que salió', () => {
    const [septiembre, agosto] = gastosPorMes(movimientos)

    expect(septiembre.mes).toBe('2026-09')
    expect(septiembre.egresos, 'los gastos se devuelven en POSITIVO para poder leerlos').toBe(200_000)
    expect(septiembre.ingresos).toBe(500_000)
    expect(septiembre.neto).toBe(300_000)
    expect(agosto.egresos).toBe(60_000)
  })

  it('ordena del mes más reciente al más viejo', () => {
    expect(gastosPorMes(movimientos).map((m) => m.mes)).toEqual(['2026-09', '2026-08'])
  })

  it('descarta lo que no tiene fecha usable en vez de romperse', () => {
    const salida = gastosPorMes([...movimientos, { fecha: 'ayer', monto: -1 }])
    expect(salida.reduce((a, m) => a + m.movimientos, 0)).toBe(movimientos.length)
  })
})

describe('egresos por concepto', () => {
  it('agrupa las líneas del banco que son el mismo gasto', () => {
    const salida = egresosPorConcepto([
      { descripcion: 'COMPRA TARJ DEB 1234 ANONIMA 05/09', monto: -50_000 },
      { descripcion: 'COMPRA TARJ DEB 9876 ANONIMA 12/09', monto: -30_000 },
      { descripcion: 'PAGO SERVICIOS EDELCA', monto: -20_000 },
    ])

    expect(salida[0].total).toBe(80_000)
    expect(salida[0].movimientos).toBe(2)
    expect(salida).toHaveLength(2)
  })

  it('los ingresos no cuentan como gasto', () => {
    expect(
      egresosPorConcepto([{ descripcion: 'TRANSFERENCIA RECIBIDA', monto: 100_000 }]),
    ).toHaveLength(0)
  })
})

describe('resumir un concepto del banco', () => {
  it('saca los números, que son lo que hace única cada línea', () => {
    expect(resumirConcepto('COMPRA TARJ DEB 1234 ANONIMA 05/09')).toBe(
      resumirConcepto('COMPRA TARJ DEB 9876 ANONIMA 12/09'),
    )
  })

  it('una descripción vacía no queda en blanco', () => {
    expect(resumirConcepto('   ')).toBe('Sin descripción')
    expect(resumirConcepto('123 456')).toBe('Sin descripción')
  })
})

describe('el tipo del movimiento', () => {
  it('el signo vive en el importe y no en un campo aparte', () => {
    /*
      Contrato explícito, porque es la decisión que sostiene todas las sumas del
      módulo: si mañana alguien agrega un campo `tipo`, hay que recordar el signo
      en cada suma, y ése es el error que aparece después como un total que no
      cierra.
    */
    const m: MovimientoExterno = {
      origen: 'banco',
      externalId: 'x',
      fecha: '2026-09-05',
      descripcion: '',
      monto: -1,
      moneda: 'ARS',
    }
    expect(Object.keys(m)).not.toContain('tipo')
  })
})
