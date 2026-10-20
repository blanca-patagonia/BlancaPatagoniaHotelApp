import { describe, it, expect } from 'vitest'
import { validarGasto, totalPorCategoria, CATEGORIAS_GASTO } from '@/lib/domain/gastos'

describe('validarGasto', () => {
  it('acepta un gasto bien formado', () => {
    expect(validarGasto({ categoria: 'servicios', descripcion: 'Luz de septiembre', monto: 120 })).toBeNull()
  })

  it('rechaza una categoría que no existe', () => {
    expect(validarGasto({ categoria: 'viajes', descripcion: 'x', monto: 10 })).toMatch(/categoría/)
  })

  it('rechaza descripción vacía, incluso solo con espacios', () => {
    expect(validarGasto({ categoria: 'otro', descripcion: '   ', monto: 10 })).toMatch(/descripción/)
  })

  it('rechaza monto cero o negativo', () => {
    expect(validarGasto({ categoria: 'otro', descripcion: 'algo', monto: 0 })).toMatch(/monto/)
    expect(validarGasto({ categoria: 'otro', descripcion: 'algo', monto: -5 })).toMatch(/monto/)
  })

  it('rechaza un monto que no es un número finito', () => {
    expect(validarGasto({ categoria: 'otro', descripcion: 'algo', monto: NaN })).toMatch(/monto/)
  })
})

describe('totalPorCategoria', () => {
  it('suma por categoría y deja en cero las que no tienen movimientos', () => {
    const totales = totalPorCategoria([
      { categoria: 'sueldos', monto: 1000 },
      { categoria: 'sueldos', monto: 500 },
      { categoria: 'servicios', monto: 80 },
    ])
    expect(totales.sueldos).toBe(1500)
    expect(totales.servicios).toBe(80)
    expect(totales.mantenimiento).toBe(0)
    expect(Object.keys(totales)).toHaveLength(CATEGORIAS_GASTO.length)
  })

  it('una lista vacía da todo en cero', () => {
    const totales = totalPorCategoria([])
    for (const c of CATEGORIAS_GASTO) expect(totales[c]).toBe(0)
  })
})
