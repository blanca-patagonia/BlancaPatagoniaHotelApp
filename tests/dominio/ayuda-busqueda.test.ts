import { describe, it, expect } from 'vitest'
import { buscarEnAyuda } from '@/lib/domain/ayuda'

describe('buscarEnAyuda (lo que lee el asistente de IA para responder dudas)', () => {
  it('encuentra el paso de la guía que responde la pregunta', () => {
    const r = buscarEnAyuda('admin', '¿Cómo bajo el libro de ventas para el contador?')
    expect(r[0].titulo).toBe('Libro de ventas para el contador')
  })

  it('no le explica a un rol pantallas a las que no puede entrar', () => {
    const r = buscarEnAyuda('housekeeping', 'libro de ventas contador facturación')
    expect(r.some((f) => f.titulo === 'Libro de ventas para el contador')).toBe(false)
  })

  it('ignora acentos y mayúsculas', () => {
    expect(buscarEnAyuda('admin', 'FACTURACION')).not.toEqual([])
  })

  it('sin palabras útiles no devuelve nada (en vez de cualquier cosa)', () => {
    expect(buscarEnAyuda('admin', '¿cómo hago?')).toEqual([])
  })

  it('respeta el máximo', () => {
    expect(buscarEnAyuda('admin', 'reserva', 3).length).toBeLessThanOrEqual(3)
  })
})
