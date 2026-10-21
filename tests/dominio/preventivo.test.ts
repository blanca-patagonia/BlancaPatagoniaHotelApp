import { describe, it, expect } from 'vitest'
import {
  periodicidadValida,
  sumarMeses,
  proximaEjecucion,
  planVencido,
  diasParaProxima,
  esInminente,
  planesAEjecutar,
  primeraEjecucionSugerida,
} from '@/lib/domain/preventivo'

const HOY = '2026-08-02'

describe('periodicidad', () => {
  it('acepta de 1 a 60 meses', () => {
    expect(periodicidadValida(1)).toBe(true)
    expect(periodicidadValida(6)).toBe(true)
    expect(periodicidadValida(60)).toBe(true)
  })

  it('rechaza cero, negativos y no enteros', () => {
    expect(periodicidadValida(0)).toBe(false)
    expect(periodicidadValida(-3)).toBe(false)
    expect(periodicidadValida(1.5)).toBe(false)
    expect(periodicidadValida(61)).toBe(false)
  })
})

describe('suma de meses', () => {
  it('mantiene el día del mes', () => {
    expect(sumarMeses('2026-08-02', 6)).toBe('2027-02-02')
    expect(sumarMeses('2026-01-15', 3)).toBe('2026-04-15')
  })

  it('cruza el cambio de año', () => {
    expect(sumarMeses('2026-11-10', 3)).toBe('2027-02-10')
  })

  it('cuando el día no existe cae en el último del mes', () => {
    // El 31 de enero + 1 mes no debe saltar al 3 de marzo.
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(sumarMeses('2026-08-31', 1)).toBe('2026-09-30')
  })

  it('respeta los años bisiestos', () => {
    expect(sumarMeses('2028-01-31', 1)).toBe('2028-02-29')
  })

  it('proximaEjecucion es la suma desde la última', () => {
    expect(proximaEjecucion('2026-08-02', 12)).toBe('2027-08-02')
  })
})

describe('vencimiento de un plan', () => {
  it('vence el mismo día programado', () => {
    expect(planVencido(HOY, HOY)).toBe(true)
    expect(planVencido('2026-08-01', HOY)).toBe(true)
  })

  it('todavía no vence si falta', () => {
    expect(planVencido('2026-08-03', HOY)).toBe(false)
  })

  it('cuenta los días que faltan', () => {
    expect(diasParaProxima('2026-08-12', HOY)).toBe(10)
    expect(diasParaProxima('2026-07-28', HOY)).toBe(-5)
  })

  it('marca como inminente lo que vence dentro de la ventana', () => {
    expect(esInminente('2026-08-10', HOY, 15)).toBe(true)
    expect(esInminente('2026-09-30', HOY, 15)).toBe(false)
    // Lo ya vencido no es «inminente»: es tarde, y se trata aparte.
    expect(esInminente('2026-07-01', HOY, 15)).toBe(false)
  })
})

describe('planes a ejecutar', () => {
  const planes = [
    { proxima_ejecucion: '2026-08-01', activo: true },
    { proxima_ejecucion: '2026-09-01', activo: true },
    { proxima_ejecucion: '2026-01-01', activo: false },
  ]

  it('toma los vencidos y activos', () => {
    expect(planesAEjecutar(planes, HOY)).toEqual([
      { proxima_ejecucion: '2026-08-01', activo: true },
    ])
  })

  it('ignora los planes desactivados aunque estén vencidos', () => {
    expect(planesAEjecutar(planes, HOY).some((p) => !p.activo)).toBe(false)
  })
})

describe('alta de un plan', () => {
  it('sugiere la primera ejecución para la semana siguiente', () => {
    expect(primeraEjecucionSugerida(HOY)).toBe('2026-08-09')
  })
})
