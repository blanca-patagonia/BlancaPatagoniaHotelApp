import { describe, it, expect } from 'vitest'
import {
  ESTADOS_RESERVA,
  ETIQUETAS_ESTADO_RESERVA,
  puedeTransicionar,
  transicionesPosibles,
  esTerminal,
  ocupaInventario,
} from '@/lib/domain/reservas'

describe('máquina de estados de la reserva', () => {
  it('define una etiqueta para cada estado', () => {
    for (const e of ESTADOS_RESERVA) {
      expect(ETIQUETAS_ESTADO_RESERVA[e]).toBeTruthy()
    }
  })

  it('permite el flujo feliz pendiente → confirmada → pagada → in_house → checkout', () => {
    expect(puedeTransicionar('pendiente', 'confirmada')).toBe(true)
    expect(puedeTransicionar('confirmada', 'pagada')).toBe(true)
    expect(puedeTransicionar('pagada', 'in_house')).toBe(true)
    expect(puedeTransicionar('in_house', 'checkout')).toBe(true)
  })

  it('rechaza transiciones inválidas', () => {
    expect(puedeTransicionar('pendiente', 'checkout')).toBe(false)
    expect(puedeTransicionar('checkout', 'in_house')).toBe(false)
    expect(puedeTransicionar('cancelada', 'confirmada')).toBe(false)
  })

  it('marca los estados terminales', () => {
    expect(esTerminal('checkout')).toBe(true)
    expect(esTerminal('cancelada')).toBe(true)
    expect(esTerminal('no_show')).toBe(true)
    expect(esTerminal('pendiente')).toBe(false)
  })

  it('identifica los estados que ocupan inventario', () => {
    expect(ocupaInventario('confirmada')).toBe(true)
    expect(ocupaInventario('in_house')).toBe(true)
    expect(ocupaInventario('cancelada')).toBe(false)
    expect(ocupaInventario('checkout')).toBe(false)
  })

  it('una reserva confirmada puede cancelarse o marcarse no-show', () => {
    expect(transicionesPosibles('confirmada')).toContain('cancelada')
    expect(transicionesPosibles('confirmada')).toContain('no_show')
  })
})
