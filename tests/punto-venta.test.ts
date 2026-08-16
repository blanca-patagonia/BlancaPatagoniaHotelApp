import { describe, it, expect } from 'vitest'
import {
  ETIQUETAS_PUNTO,
  PUNTOS_VENTA,
  esPuntoVenta,
  filtrarCatalogo,
  lineasCargadas,
  puntoSugerido,
  subtotalLinea,
  totalComanda,
  validarComanda,
  type LineaComanda,
} from '@/lib/domain/punto-venta'

/**
 * El punto de venta cobra plata, así que lo que se prueba acá son las cuentas y
 * las guardas: que el total sume bien, que no se pueda cargar más de lo que hay en
 * stock, y que el buscador encuentre lo que alguien escribe rápido y sin acentos.
 */

function linea(over: Partial<LineaComanda> = {}): LineaComanda {
  return { productoId: 'p1', nombre: 'Cerveza artesanal', cantidad: 1, precioUnitario: 7, ...over }
}

describe('subtotalLinea', () => {
  it('multiplica cantidad por precio', () => {
    expect(subtotalLinea({ cantidad: 3, precioUnitario: 7 })).toBe(21)
  })

  it('redondea a dos decimales', () => {
    expect(subtotalLinea({ cantidad: 3, precioUnitario: 7.335 })).toBe(22.01)
  })

  it('no devuelve NaN ni negativos', () => {
    expect(subtotalLinea({ cantidad: Number.NaN, precioUnitario: 7 })).toBe(0)
    expect(subtotalLinea({ cantidad: -2, precioUnitario: 7 })).toBe(0)
    expect(subtotalLinea({ cantidad: 2, precioUnitario: -7 })).toBe(0)
  })
})

describe('totalComanda', () => {
  it('suma todas las líneas', () => {
    expect(
      totalComanda([
        linea({ cantidad: 2, precioUnitario: 7 }),
        linea({ productoId: 'p2', cantidad: 1, precioUnitario: 18 }),
      ]),
    ).toBe(32)
  })

  it('una comanda vacía da cero', () => {
    expect(totalComanda([])).toBe(0)
  })

  it('acumula sin arrastrar error de punto flotante', () => {
    // 0,1 × 3 en coma flotante da 0,30000000000000004.
    const lineas = Array.from({ length: 3 }, () => linea({ cantidad: 1, precioUnitario: 0.1 }))
    expect(totalComanda(lineas)).toBe(0.3)
  })
})

describe('lineasCargadas', () => {
  it('deja afuera las que están en cero', () => {
    // La grilla muestra el catálogo entero; sólo viaja lo que tiene cantidad.
    const lineas = [linea({ cantidad: 0 }), linea({ productoId: 'p2', cantidad: 2 })]
    expect(lineasCargadas(lineas)).toHaveLength(1)
    expect(lineasCargadas(lineas)[0].productoId).toBe('p2')
  })
})

describe('validarComanda', () => {
  it('acepta una comanda normal', () => {
    expect(validarComanda([linea({ cantidad: 2 })])).toEqual([])
  })

  it('rechaza una comanda sin nada cargado', () => {
    expect(validarComanda([])).toContain('Cargá al menos un producto con cantidad mayor que cero.')
    expect(validarComanda([linea({ cantidad: 0 })])).not.toEqual([])
  })

  it('rechaza cantidades no enteras', () => {
    expect(validarComanda([linea({ cantidad: 1.5 })])).not.toEqual([])
  })

  it('rechaza cargar más de lo que hay en stock, y dice cuánto hay', () => {
    // El mensaje tiene que servirle a quien está en el mostrador con el huésped
    // enfrente: «quedan 2» se puede resolver, «error de validación» no.
    const motivos = validarComanda([linea({ cantidad: 5, stock: 2 })])
    expect(motivos[0]).toContain('quedan 2')
    expect(motivos[0]).toContain('se cargaron 5')
  })

  it('un producto sin control de stock no tiene tope', () => {
    // Una excursión o un traslado no se cuentan por unidades en depósito.
    expect(validarComanda([linea({ cantidad: 99, stock: null })])).toEqual([])
  })

  it('acepta exactamente el stock disponible', () => {
    expect(validarComanda([linea({ cantidad: 2, stock: 2 })])).toEqual([])
  })

  it('junta los problemas de varias líneas', () => {
    const motivos = validarComanda([
      linea({ cantidad: 5, stock: 1 }),
      linea({ productoId: 'p2', nombre: 'Vino', cantidad: 3, stock: 0 }),
    ])
    expect(motivos).toHaveLength(2)
  })
})

describe('filtrarCatalogo', () => {
  const catalogo = [
    { nombre: 'Café de especialidad', codigo: 'BAR-CAFE' },
    { nombre: 'Cerveza artesanal', codigo: 'FRI-CERV' },
    { nombre: 'Vino patagónico', codigo: 'FRI-VINO' },
  ]

  it('encuentra sin acentos: nadie los escribe cuando busca rápido', () => {
    expect(filtrarCatalogo(catalogo, 'cafe')).toHaveLength(1)
    expect(filtrarCatalogo(catalogo, 'patagonico')).toHaveLength(1)
  })

  it('no distingue mayúsculas', () => {
    expect(filtrarCatalogo(catalogo, 'CERVEZA')).toHaveLength(1)
  })

  it('busca también por código', () => {
    expect(filtrarCatalogo(catalogo, 'FRI-')).toHaveLength(2)
  })

  it('sin término devuelve todo', () => {
    expect(filtrarCatalogo(catalogo, '')).toHaveLength(3)
    expect(filtrarCatalogo(catalogo, '   ')).toHaveLength(3)
  })

  it('sin coincidencias devuelve vacío, no todo', () => {
    expect(filtrarCatalogo(catalogo, 'zzz')).toEqual([])
  })
})

describe('puntos de venta', () => {
  it('cada punto tiene etiqueta', () => {
    for (const p of PUNTOS_VENTA) expect(ETIQUETAS_PUNTO[p]).toBeTruthy()
  })

  it('valida lo que llega de un formulario', () => {
    expect(esPuntoVenta('frigobar')).toBe(true)
    expect(esPuntoVenta('cualquier_cosa')).toBe(false)
  })

  it('sugiere el punto según la categoría del producto', () => {
    expect(puntoSugerido('frigobar')).toBe('frigobar')
    expect(puntoSugerido('excursion')).toBe('excursiones')
    expect(puntoSugerido('desayuno')).toBe('restaurante')
    expect(puntoSugerido('traslado')).toBe('recepcion')
    expect(puntoSugerido('otro')).toBe('recepcion')
  })
})
