import { describe, it, expect } from 'vitest'
import {
  parsearRango,
  formatearRango,
  rangoInvalido,
  diasDelRango,
  huecosDeCobertura,
  tieneCobertura,
  cubiertoHasta,
} from '@/lib/domain/temporadas'

/*
  El caso que originó este módulo: los rangos cargados terminaban el 2026-06-01
  y el hotel siguió operando. Al reservar para agosto el sistema mostraba USD 0
  y recién al confirmar avisaba que faltaba la tarifa.
*/
const CARGADOS = [
  { desde: '2025-12-20', hasta: '2026-03-01' },
  { desde: '2026-03-01', hasta: '2026-03-29' },
  { desde: '2026-03-29', hasta: '2026-04-05' },
  { desde: '2026-04-05', hasta: '2026-06-01' },
]

describe('temporadas · formato de la base', () => {
  it('lee el daterange de Postgres', () => {
    expect(parsearRango('[2026-01-01,2026-03-01)')).toEqual({
      desde: '2026-01-01',
      hasta: '2026-03-01',
    })
  })

  it('escribe el literal con el fin excluido', () => {
    expect(formatearRango('2026-01-01', '2026-03-01')).toBe('[2026-01-01,2026-03-01)')
  })

  it('cuenta las noches, no los días de calendario', () => {
    // Del 1 al 8 con el fin excluido son 7 noches.
    expect(diasDelRango({ desde: '2026-01-01', hasta: '2026-01-08' })).toBe(7)
  })
})

describe('temporadas · validación al cargar', () => {
  it('exige las dos fechas', () => {
    expect(rangoInvalido('', '2026-01-08')).toMatch(/inicio/i)
    expect(rangoInvalido('2026-01-01', '')).toMatch(/inicio/i)
  })

  it('rechaza un fin anterior o igual al inicio', () => {
    expect(rangoInvalido('2026-01-08', '2026-01-01')).toMatch(/posterior/i)
    expect(rangoInvalido('2026-01-01', '2026-01-01')).toMatch(/posterior/i)
  })

  it('acepta un rango correcto', () => {
    expect(rangoInvalido('2026-01-01', '2026-01-08')).toBeNull()
  })
})

describe('temporadas · dónde el sistema no puede cotizar', () => {
  it('detecta el hueco real que rompió las reservas', () => {
    // Con los rangos que había cargados, agosto de 2026 no tiene temporada.
    const huecos = huecosDeCobertura(CARGADOS, '2026-06-01', '2026-09-01')
    expect(huecos).toHaveLength(1)
    expect(huecos[0].desde).toBe('2026-06-01')
    expect(huecos[0].hasta).toBe('2026-09-01')
  })

  it('no reporta nada cuando la cobertura es continua', () => {
    expect(huecosDeCobertura(CARGADOS, '2026-01-01', '2026-06-01')).toHaveLength(0)
  })

  it('encuentra un hueco en el medio', () => {
    const conAgujero = [
      { desde: '2026-01-01', hasta: '2026-02-01' },
      { desde: '2026-03-01', hasta: '2026-04-01' },
    ]
    const huecos = huecosDeCobertura(conAgujero, '2026-01-01', '2026-04-01')
    expect(huecos).toEqual([{ desde: '2026-02-01', hasta: '2026-03-01', dias: 28 }])
  })

  it('ordena los rangos: pueden venir de la base en cualquier orden', () => {
    const desordenados = [
      { desde: '2026-03-01', hasta: '2026-04-01' },
      { desde: '2026-01-01', hasta: '2026-02-01' },
    ]
    const huecos = huecosDeCobertura(desordenados, '2026-01-01', '2026-04-01')
    expect(huecos).toHaveLength(1)
    expect(huecos[0].desde).toBe('2026-02-01')
  })

  it('sin ningún rango, todo el período es un hueco', () => {
    const huecos = huecosDeCobertura([], '2026-01-01', '2026-02-01')
    expect(huecos).toEqual([{ desde: '2026-01-01', hasta: '2026-02-01', dias: 31 }])
  })

  it('un rango contenido en otro no hace retroceder el recorrido', () => {
    // Si el cursor volviera atrás, aparecería un hueco inventado.
    const anidados = [
      { desde: '2026-01-01', hasta: '2026-03-01' },
      { desde: '2026-01-10', hasta: '2026-01-20' },
    ]
    expect(huecosDeCobertura(anidados, '2026-01-01', '2026-03-01')).toHaveLength(0)
  })
})

describe('temporadas · hasta cuándo se puede vender', () => {
  it('dice si una fecha tiene temporada', () => {
    expect(tieneCobertura(CARGADOS, '2026-02-15')).toBe(true)
    expect(tieneCobertura(CARGADOS, '2026-08-07')).toBe(false)
  })

  it('el último día del rango está excluido', () => {
    // `[..,2026-06-01)` cubre hasta el 31 de mayo inclusive.
    expect(tieneCobertura(CARGADOS, '2026-05-31')).toBe(true)
    expect(tieneCobertura(CARGADOS, '2026-06-01')).toBe(false)
  })

  it('encadena rangos contiguos hasta el último día vendible', () => {
    // Los cuatro rangos son contiguos: desde enero se vende hasta el 31/5.
    expect(cubiertoHasta(CARGADOS, '2026-01-15')).toBe('2026-05-31')
  })

  it('devuelve null si la fecha de partida ya está descubierta', () => {
    expect(cubiertoHasta(CARGADOS, '2026-08-07')).toBeNull()
  })
})
