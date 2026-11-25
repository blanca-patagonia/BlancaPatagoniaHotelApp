import { describe, it, expect } from 'vitest'
import {
  cajaEnPeriodo,
  cajaPorDia,
  diasDelMesHasta,
  mismoTramoDelMesAnterior,
  ordenarDeudores,
  type MovimientoCaja,
} from '@/lib/domain/caja'

/**
 * La caja del tablero de Inicio. Lo delicado: qué cuenta como plata que entró
 * (aprobados, con los reembolsos restando), en qué DÍA del hotel cae un cobro, y
 * contra qué se compara el mes en curso.
 */

const pago = (monto: number, creado_en: string, extra: Partial<MovimientoCaja> = {}): MovimientoCaja => ({
  tipo: 'saldo',
  monto,
  estado: 'aprobado',
  creado_en,
  ...extra,
})

describe('cajaEnPeriodo', () => {
  const NOV = { inicio: '2026-11-01', fin: '2026-12-01' }

  it('suma seña y saldo aprobados y resta los reembolsos', () => {
    const c = cajaEnPeriodo(
      [
        pago(100, '2026-11-05T15:00:00Z', { tipo: 'senia' }),
        pago(250.5, '2026-11-06T15:00:00Z'),
        pago(40, '2026-11-07T15:00:00Z', { tipo: 'reembolso' }),
      ],
      NOV,
    )
    expect(c).toEqual({ ingresos: 350.5, reembolsos: 40, neto: 310.5, cobros: 2 })
  })

  it('no cuenta lo pendiente, lo rechazado ni lo que ya se devolvió', () => {
    const c = cajaEnPeriodo(
      [
        pago(100, '2026-11-05T15:00:00Z', { estado: 'pendiente' }),
        pago(100, '2026-11-05T15:00:00Z', { estado: 'rechazado' }),
        pago(100, '2026-11-05T15:00:00Z', { estado: 'reembolsado' }),
      ],
      NOV,
    )
    expect(c.neto).toBe(0)
    expect(c.cobros).toBe(0)
  })

  it('un cobro de las 22:00 del hotel cae en ese día, no en el siguiente', () => {
    // 2026-12-01T01:00Z son las 22:00 del 30 de noviembre en El Calafate.
    const c = cajaEnPeriodo([pago(80, '2026-12-01T01:00:00Z')], NOV)
    expect(c.neto).toBe(80)
  })

  it('acepta importes como texto, que es como llegan los `numeric` de la base', () => {
    expect(cajaEnPeriodo([pago('19.90' as unknown as number, '2026-11-05T15:00:00Z')], NOV).neto).toBe(19.9)
  })
})

describe('cajaPorDia y diasDelMesHasta', () => {
  it('los días del mes van del 1 a hoy inclusive', () => {
    expect(diasDelMesHasta('2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
  })

  it('cada día tiene su neto, y los días sin cobros quedan en cero', () => {
    const serie = cajaPorDia([pago(50, '2026-11-02T13:00:00Z')], diasDelMesHasta('2026-11-03'))
    expect(serie.map((d) => d.neto)).toEqual([0, 50, 0])
  })
})

describe('mismoTramoDelMesAnterior', () => {
  it('compara del 1 a hoy contra del 1 al mismo día del mes anterior', () => {
    expect(mismoTramoDelMesAnterior('2026-11-22')).toEqual({ inicio: '2026-10-01', fin: '2026-10-23' })
  })

  it('si el mes anterior es más corto, llega hasta su último día', () => {
    expect(mismoTramoDelMesAnterior('2026-03-31')).toEqual({ inicio: '2026-02-01', fin: '2026-03-01' })
  })

  it('en enero compara con diciembre del año anterior', () => {
    expect(mismoTramoDelMesAnterior('2027-01-10')).toEqual({ inicio: '2026-12-01', fin: '2026-12-11' })
  })
})

describe('ordenarDeudores', () => {
  it('los que más deben primero, con desempate estable por código', () => {
    const orden = ordenarDeudores([
      { id: '1', codigo: 'BP-0002', huesped: 'B', saldo: 50 },
      { id: '2', codigo: 'BP-0001', huesped: 'A', saldo: 50 },
      { id: '3', codigo: 'BP-0003', huesped: 'C', saldo: 300 },
    ])
    expect(orden.map((d) => d.codigo)).toEqual(['BP-0003', 'BP-0001', 'BP-0002'])
  })
})
