import { describe, it, expect } from 'vitest'
import { nivelFidelidad, puntosPorEstadia } from '@/lib/domain/fidelidad'

describe('nivelFidelidad', () => {
  it('asigna el nivel según los puntos', () => {
    expect(nivelFidelidad(0)).toBe('bronce')
    expect(nivelFidelidad(499)).toBe('bronce')
    expect(nivelFidelidad(500)).toBe('plata')
    expect(nivelFidelidad(2000)).toBe('oro')
    expect(nivelFidelidad(5000)).toBe('platino')
  })
})

describe('puntosPorEstadia', () => {
  it('otorga 1 punto por cada USD 10 del total', () => {
    expect(puntosPorEstadia(642.51)).toBe(64)
    expect(puntosPorEstadia(9)).toBe(0)
    expect(puntosPorEstadia(0)).toBe(0)
  })
})
