import { describe, it, expect } from 'vitest'
import { llevaStock, stockBajo, faltantes } from '@/lib/domain/inventario'

/*
  Estos tests nacen de un error encontrado usando el sistema: el tablero avisaba
  «4 productos con stock bajo» y Configuración mostraba 0. Los cuatro eran
  servicios —excursiones y traslados— que no llevan inventario.
*/

const gaseosa = { stock: 24, stock_minimo: 6 }
const gaseosaJusta = { stock: 6, stock_minimo: 6 }
const gaseosaAgotada = { stock: 0, stock_minimo: 6 }
const excursion = { stock: null, stock_minimo: 0 }
const traslado = { stock: null, stock_minimo: null }

describe('inventario · qué lleva stock', () => {
  it('un producto con existencias lleva stock', () => {
    expect(llevaStock(gaseosa)).toBe(true)
  })

  it('un servicio no lleva stock', () => {
    expect(llevaStock(excursion)).toBe(false)
    expect(llevaStock(traslado)).toBe(false)
  })
})

describe('inventario · cuándo hay que reponer', () => {
  it('NO marca como faltante a un servicio', () => {
    // El error original: `Number(null ?? 0) <= 0` daba verdadero y las cuatro
    // excursiones aparecían como stock bajo en el tablero.
    expect(stockBajo(excursion)).toBe(false)
    expect(stockBajo(traslado)).toBe(false)
  })

  it('no marca un producto con existencias holgadas', () => {
    expect(stockBajo(gaseosa)).toBe(false)
  })

  it('marca cuando llegó justo al mínimo', () => {
    // Al mínimo ya hay que reponer: si se espera a bajar de él, se llega tarde.
    expect(stockBajo(gaseosaJusta)).toBe(true)
  })

  it('marca cuando está agotado', () => {
    expect(stockBajo(gaseosaAgotada)).toBe(true)
  })

  it('trata un mínimo sin definir como cero', () => {
    expect(stockBajo({ stock: 5, stock_minimo: null })).toBe(false)
    expect(stockBajo({ stock: 0, stock_minimo: null })).toBe(true)
  })
})

describe('inventario · el listado que ven tablero y configuración', () => {
  it('devuelve solo los productos a reponer, sin servicios', () => {
    const catalogo = [gaseosa, excursion, gaseosaAgotada, traslado, gaseosaJusta]
    expect(faltantes(catalogo)).toEqual([gaseosaAgotada, gaseosaJusta])
  })

  it('con un catálogo de puros servicios no reporta nada', () => {
    // Es exactamente el caso que se veía mal: el tablero decía 4.
    expect(faltantes([excursion, traslado, excursion, traslado])).toHaveLength(0)
  })
})
