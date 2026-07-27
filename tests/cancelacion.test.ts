import { describe, it, expect } from 'vitest'
import {
  cargoPorCancelacion,
  montoCancelacion,
  type ReglaCancelacion,
} from '@/lib/domain/cancelacion'

// Política estándar del Tarifario Blanca Patagonia.
const reglas: ReglaCancelacion[] = [
  { desde_dias: 14, cargo: 'ninguno' },
  { desde_dias: 7, cargo: 'primera_noche' },
  { desde_dias: 0, cargo: 'total' },
]

describe('cargoPorCancelacion', () => {
  it('no cobra si se cancela con más de 14 días', () => {
    expect(cargoPorCancelacion(reglas, 20)).toBe('ninguno')
    expect(cargoPorCancelacion(reglas, 14)).toBe('ninguno')
  })
  it('cobra la primera noche entre 14 y 7 días', () => {
    expect(cargoPorCancelacion(reglas, 10)).toBe('primera_noche')
    expect(cargoPorCancelacion(reglas, 7)).toBe('primera_noche')
  })
  it('cobra el total dentro de los 7 días', () => {
    expect(cargoPorCancelacion(reglas, 6)).toBe('total')
    expect(cargoPorCancelacion(reglas, 0)).toBe('total')
  })
})

describe('montoCancelacion', () => {
  const base = { totalEstadia: 500, primeraNoche: 120 }

  it('traduce cada tipo de cargo a un monto', () => {
    expect(montoCancelacion({ ...base, cargo: 'ninguno' })).toBe(0)
    expect(montoCancelacion({ ...base, cargo: 'primera_noche' })).toBe(120)
    expect(montoCancelacion({ ...base, cargo: 'total' })).toBe(500)
  })

  it('el no-show cobra el 100% de la estadía', () => {
    expect(montoCancelacion({ ...base, cargo: 'ninguno', noShow: true })).toBe(500)
  })
})
