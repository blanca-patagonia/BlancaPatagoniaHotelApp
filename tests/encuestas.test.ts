import { describe, it, expect } from 'vitest'
import {
  clasificarNps,
  puntajeValido,
  resumenNps,
  interpretarNps,
  tasaRespuesta,
} from '@/lib/domain/encuestas'

describe('clasificación NPS', () => {
  it('de 0 a 6 son detractores', () => {
    for (const p of [0, 3, 6]) expect(clasificarNps(p)).toBe('detractor')
  })

  it('7 y 8 son pasivos', () => {
    expect(clasificarNps(7)).toBe('pasivo')
    expect(clasificarNps(8)).toBe('pasivo')
  })

  it('9 y 10 son promotores', () => {
    expect(clasificarNps(9)).toBe('promotor')
    expect(clasificarNps(10)).toBe('promotor')
  })
})

describe('validación del puntaje', () => {
  it('acepta enteros de 0 a 10', () => {
    expect(puntajeValido(0)).toBe(true)
    expect(puntajeValido(10)).toBe(true)
  })

  it('rechaza fuera de rango y no enteros', () => {
    expect(puntajeValido(-1)).toBe(false)
    expect(puntajeValido(11)).toBe(false)
    expect(puntajeValido(7.5)).toBe(false)
  })
})

describe('cálculo del NPS', () => {
  it('promotores menos detractores sobre el total', () => {
    // 3 promotores, 1 pasivo, 1 detractor => (3-1)/5 = 40 %
    const r = resumenNps([10, 9, 9, 8, 4])
    expect(r.nps).toBe(40)
    expect(r.promotores).toBe(3)
    expect(r.pasivos).toBe(1)
    expect(r.detractores).toBe(1)
    expect(r.respuestas).toBe(5)
  })

  it('todo promotores da 100 y todo detractores da -100', () => {
    expect(resumenNps([9, 10, 10]).nps).toBe(100)
    expect(resumenNps([0, 3, 6]).nps).toBe(-100)
  })

  it('los pasivos no suman ni restan', () => {
    expect(resumenNps([7, 8, 7, 8]).nps).toBe(0)
  })

  it('DESCARTA las encuestas sin responder en lugar de contarlas como cero', () => {
    // Si los null contaran como detractores, el NPS se desplomaría.
    const r = resumenNps([10, 10, null, undefined])
    expect(r.respuestas).toBe(2)
    expect(r.nps).toBe(100)
  })

  it('descarta puntajes inválidos', () => {
    expect(resumenNps([10, 99, -5, 7.5]).respuestas).toBe(1)
  })

  it('sin respuestas no inventa un número', () => {
    const r = resumenNps([])
    expect(r.nps).toBeNull()
    expect(r.promedio).toBeNull()
    expect(r.respuestas).toBe(0)
  })

  it('calcula el promedio simple como dato complementario', () => {
    expect(resumenNps([10, 8]).promedio).toBe(9)
  })
})

describe('lectura cualitativa', () => {
  it('traduce el índice a una valoración', () => {
    expect(interpretarNps(80)).toBe('Excelente')
    expect(interpretarNps(55)).toBe('Muy bueno')
    expect(interpretarNps(10)).toBe('Aceptable')
    expect(interpretarNps(-20)).toBe('Requiere atención')
    expect(interpretarNps(null)).toMatch(/sin respuestas/i)
  })
})

describe('tasa de respuesta', () => {
  it('calcula el porcentaje de encuestas contestadas', () => {
    expect(tasaRespuesta(10, 4)).toBe(40)
  })

  it('sin encuestas enviadas no hay tasa', () => {
    expect(tasaRespuesta(0, 0)).toBeNull()
  })
})
