import { describe, it, expect } from 'vitest'
import { puedeCargarConsumo, motivoNoCargable, MENSAJES_NO_CARGABLE } from '@/lib/domain/servicio'

describe('cuándo se le puede cargar un consumo a una reserva', () => {
  it('al que llegó temprano y todavía no hizo check-in SÍ se le puede cobrar', () => {
    // Es el caso del pedido: son las 9, el check-in es a las 15, desayuna igual.
    expect(puedeCargarConsumo('confirmada')).toBe(true)
    expect(puedeCargarConsumo('pagada')).toBe(true)
  })

  it('al que ya hizo check-out esta mañana también, porque desayunó de verdad', () => {
    expect(puedeCargarConsumo('checkout')).toBe(true)
  })

  it('lo que cierra la cuenta es la FACTURA, no el check-out', () => {
    // Un cargo posterior no entraría en el comprobante ya emitido, y `facturas`
    // es inmutable (migración 0034).
    expect(puedeCargarConsumo('checkout', true)).toBe(false)
    expect(motivoNoCargable('checkout', true)).toBe('cargo_ya_facturada')
    expect(puedeCargarConsumo('in_house', true)).toBe(false)
  })

  it('una reserva cancelada o no-show no admite cargos: no hubo servicio', () => {
    expect(puedeCargarConsumo('cancelada')).toBe(false)
    expect(puedeCargarConsumo('no_show')).toBe(false)
    expect(motivoNoCargable('cancelada', false)).toBe('cargo_anulada')
  })

  it('cada motivo explica qué hacer, no solo que no se puede', () => {
    expect(MENSAJES_NO_CARGABLE.cargo_ya_facturada).toMatch(/cobralo aparte/i)
    expect(MENSAJES_NO_CARGABLE.cargo_anulada.length).toBeGreaterThan(30)
  })
})
