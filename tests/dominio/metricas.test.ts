import { describe, it, expect } from 'vitest'
import {
  mesRelativo,
  ultimosMeses,
  metricasDeMes,
  metricasDeSemana,
  semanaRelativa,
  ultimasSemanas,
  etiquetaSemana,
  variacionPct,
  etiquetaMes,
  textoOcupacion,
  textoRevPAR,
  type EstadiaMetrica,
} from '@/lib/domain/metricas'

describe('aritmética de meses', () => {
  it('avanza y retrocede dentro del año', () => {
    expect(mesRelativo('2026-05', 1)).toBe('2026-06')
    expect(mesRelativo('2026-05', -2)).toBe('2026-03')
  })

  it('cruza el cambio de año', () => {
    expect(mesRelativo('2026-01', -1)).toBe('2025-12')
    expect(mesRelativo('2026-12', 1)).toBe('2027-01')
    expect(mesRelativo('2026-02', -14)).toBe('2024-12')
  })

  it('lista los últimos meses en orden cronológico', () => {
    expect(ultimosMeses('2026-03', 4)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03'])
  })
})

describe('métricas hoteleras del mes', () => {
  // Enero 2026 tiene 31 días; con 2 unidades hay 62 noches disponibles.
  const UNIDADES = 2

  it('sin estadías da todo en cero pero conserva la capacidad', () => {
    const m = metricasDeMes([], '2026-01', UNIDADES)
    expect(m.nochesDisponibles).toBe(62)
    expect(m.nochesVendidas).toBe(0)
    expect(m.ocupacionPct).toBe(0)
    expect(m.adr).toBe(0)
    expect(m.revpar).toBe(0)
  })

  it('calcula ocupación, ADR y RevPAR', () => {
    // 10 noches a USD 100 => ingreso 1000.
    const estadias: EstadiaMetrica[] = [{ periodo: '[2026-01-05,2026-01-15)', precio_noche: 100 }]
    const m = metricasDeMes(estadias, '2026-01', UNIDADES)
    expect(m.nochesVendidas).toBe(10)
    expect(m.ingreso).toBe(1000)
    expect(m.ocupacionPct).toBe(16) // 10/62 = 16,1 %
    expect(m.adr).toBe(100)
    expect(m.revpar).toBe(16) // 1000/62 = 16,1
  })

  it('prorratea una estadía a caballo entre dos meses', () => {
    // Del 28/01 al 03/02: 4 noches caen en enero y 2 en febrero.
    const estadias: EstadiaMetrica[] = [{ periodo: '[2026-01-28,2026-02-03)', precio_noche: 50 }]
    expect(metricasDeMes(estadias, '2026-01', UNIDADES).nochesVendidas).toBe(4)
    expect(metricasDeMes(estadias, '2026-02', UNIDADES).nochesVendidas).toBe(2)
    expect(metricasDeMes(estadias, '2026-01', UNIDADES).ingreso).toBe(200)
  })

  it('ignora las estadías de otros meses', () => {
    const estadias: EstadiaMetrica[] = [{ periodo: '[2026-03-01,2026-03-05)', precio_noche: 80 }]
    expect(metricasDeMes(estadias, '2026-01', UNIDADES).nochesVendidas).toBe(0)
  })

  it('tolera un precio nulo', () => {
    const estadias: EstadiaMetrica[] = [{ periodo: '[2026-01-01,2026-01-03)', precio_noche: null }]
    const m = metricasDeMes(estadias, '2026-01', UNIDADES)
    expect(m.nochesVendidas).toBe(2)
    expect(m.ingreso).toBe(0)
  })

  it('sin unidades activas no hay capacidad ni división por cero', () => {
    const m = metricasDeMes([{ periodo: '[2026-01-01,2026-01-03)', precio_noche: 90 }], '2026-01', 0)
    expect(m.nochesDisponibles).toBe(0)
    expect(m.ocupacionPct).toBe(0)
    expect(m.revpar).toBe(0)
  })
})

describe('variación porcentual', () => {
  it('calcula subidas y bajadas', () => {
    expect(variacionPct(120, 100)).toBe(20)
    expect(variacionPct(80, 100)).toBe(-20)
  })

  it('no compara contra cero', () => {
    expect(variacionPct(50, 0)).toBeNull()
  })
})

describe('etiqueta de mes', () => {
  it('abrevia mes y año', () => {
    expect(etiquetaMes('2026-01')).toBe('ene 26')
    expect(etiquetaMes('2025-12')).toBe('dic 25')
  })
})

describe('métricas hoteleras de la semana', () => {
  it('cuenta solo las noches de la semana pedida, lunes a domingo', () => {
    // Semana del 2026-09-14 (lunes) al 2026-09-21 (exclusivo).
    const estadias: EstadiaMetrica[] = [
      { periodo: '[2026-09-13,2026-09-16)', precio_noche: 100 }, // entra domingo, se van 2 noches de esta semana
      { periodo: '[2026-09-20,2026-09-23)', precio_noche: 50 }, // solo el domingo cuenta
    ]
    const m = metricasDeSemana(estadias, '2026-09-14', 1)
    expect(m.semana).toBe('2026-09-14')
    expect(m.nochesDisponibles).toBe(7)
    expect(m.nochesVendidas).toBe(3) // 2 + 1
    expect(m.ingreso).toBe(250) // 2*100 + 1*50
  })

  it('semanaRelativa avanza de a 7 días, cruzando mes', () => {
    expect(semanaRelativa('2026-09-28', 1)).toBe('2026-10-05')
    expect(semanaRelativa('2026-09-28', -1)).toBe('2026-09-21')
  })

  it('ultimasSemanas lista en orden cronológico', () => {
    expect(ultimasSemanas('2026-09-14', 3)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14'])
  })

  it('etiquetaSemana muestra el rango corto, dentro y a través de un mes', () => {
    expect(etiquetaSemana('2026-09-14')).toBe('14-20 sep')
    expect(etiquetaSemana('2026-09-28')).toBe('28 sep - 4 oct')
  })
})

describe('precisión con poco volumen', () => {
  it('textoOcupacion distingue "vendí poco" de "no vendí nada"', () => {
    // 1 noche sobre 1410 disponibles: 0,07%, Math.round ya lo dejó en 0.
    expect(textoOcupacion(1, 0)).toBe('<1%')
    expect(textoOcupacion(0, 0)).toBe('0%')
    expect(textoOcupacion(300, 45)).toBe('45%')
  })

  it('textoRevPAR recalcula sin el redondeo a entero cuando hubo ingreso', () => {
    // USD 240 sobre 1410 noches disponibles: USD 0,17, no "USD 0,00".
    expect(textoRevPAR(240, 1410, 0)).toBe('USD 0,17')
    expect(textoRevPAR(0, 1410, 0)).toBe('USD 0,00')
    expect(textoRevPAR(45000, 1000, 45)).toBe('USD 45,00')
  })
})
