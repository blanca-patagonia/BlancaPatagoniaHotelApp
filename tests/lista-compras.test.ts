import { describe, it, expect } from 'vitest'
import { totalPendiente, totalComprado, cantidadPendiente } from '@/lib/domain/lista-compras'

describe('lista de compras de cocina', () => {
  const items = [
    { precioEstimado: 1500, comprado: false },
    { precioEstimado: 800, comprado: true },
    { precioEstimado: null, comprado: false },
    { precioEstimado: 300, comprado: false },
  ]

  it('suma lo pendiente, sin contar lo ya comprado', () => {
    expect(totalPendiente(items)).toBe(1800)
  })

  it('suma lo ya comprado por separado', () => {
    expect(totalComprado(items)).toBe(800)
  })

  it('un precio sin cargar no rompe la suma, cuenta como cero', () => {
    expect(totalPendiente([{ precioEstimado: null, comprado: false }])).toBe(0)
  })

  it('cuenta cuántos ítems faltan comprar', () => {
    expect(cantidadPendiente(items)).toBe(3)
  })

  it('lista vacía da todo en cero', () => {
    expect(totalPendiente([])).toBe(0)
    expect(totalComprado([])).toBe(0)
    expect(cantidadPendiente([])).toBe(0)
  })
})
