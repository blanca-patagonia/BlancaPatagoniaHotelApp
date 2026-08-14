import { describe, it, expect } from 'vitest'
import {
  desayunaEn,
  listaDeDesayuno,
  resumenDeVentas,
  type EstadiaServicio,
  type ConsumoVendido,
} from '@/lib/domain/servicio'

/**
 * El borde del desayuno es el que más se equivoca a mano, y falla de dos formas
 * distintas: contar de más infla el pedido a cocina (nadie lo nota) y contar de
 * menos deja a alguien sin cubierto (lo nota el huésped).
 */

describe('desayunaEn', () => {
  // Estadía del 10 al 13: duerme las noches 10, 11 y 12. Se va el 13.
  const checkIn = '2026-03-10'
  const checkOut = '2026-03-13'

  it('NO desayuna el día que llega: entra a la tarde', () => {
    expect(desayunaEn(checkIn, checkOut, '2026-03-10')).toBe(false)
  })

  it('desayuna las mañanas siguientes a cada noche dormida', () => {
    expect(desayunaEn(checkIn, checkOut, '2026-03-11')).toBe(true)
    expect(desayunaEn(checkIn, checkOut, '2026-03-12')).toBe(true)
  })

  it('SÍ desayuna el día que se va: durmió anoche y come antes de irse', () => {
    expect(desayunaEn(checkIn, checkOut, '2026-03-13')).toBe(true)
  })

  it('no desayuna después de irse', () => {
    expect(desayunaEn(checkIn, checkOut, '2026-03-14')).toBe(false)
  })

  it('no desayuna antes de llegar', () => {
    expect(desayunaEn(checkIn, checkOut, '2026-03-09')).toBe(false)
  })

  it('una estadía de una noche desayuna una sola mañana', () => {
    expect(desayunaEn('2026-03-10', '2026-03-11', '2026-03-10')).toBe(false)
    expect(desayunaEn('2026-03-10', '2026-03-11', '2026-03-11')).toBe(true)
  })

  it('cruza el fin de mes sin romperse', () => {
    expect(desayunaEn('2026-03-30', '2026-04-02', '2026-04-01')).toBe(true)
    expect(desayunaEn('2026-03-30', '2026-04-02', '2026-04-02')).toBe(true)
    expect(desayunaEn('2026-03-30', '2026-04-02', '2026-04-03')).toBe(false)
  })

  it('cruza el 29 de febrero de un año bisiesto', () => {
    expect(desayunaEn('2028-02-28', '2028-03-01', '2028-02-29')).toBe(true)
    expect(desayunaEn('2028-02-28', '2028-03-01', '2028-03-01')).toBe(true)
  })
})

describe('listaDeDesayuno', () => {
  const estadias: EstadiaServicio[] = [
    { reservaCodigo: 'R-3', unidad: 'CAB-2', huesped: 'Suárez', checkIn: '2026-03-09', checkOut: '2026-03-12', huespedes: 4 },
    { reservaCodigo: 'R-1', unidad: 'HAB-10', huesped: 'Pérez', checkIn: '2026-03-10', checkOut: '2026-03-13', huespedes: 2 },
    { reservaCodigo: 'R-2', unidad: 'HAB-2', huesped: 'Gómez', checkIn: '2026-03-12', checkOut: '2026-03-15', huespedes: 1 },
  ]

  it('incluye solo a quienes durmieron anoche', () => {
    const lista = listaDeDesayuno(estadias, '2026-03-12')
    // Gómez llegó el 12: todavía no desayuna. Suárez se va el 12: sí desayuna.
    expect(lista.lineas.map((l) => l.huesped)).toEqual(['CAB-2', 'HAB-10'].map((u) =>
      estadias.find((e) => e.unidad === u)!.huesped,
    ))
  })

  it('suma los cubiertos, no las habitaciones', () => {
    const lista = listaDeDesayuno(estadias, '2026-03-12')
    expect(lista.totalCubiertos).toBe(6) // Suárez 4 + Pérez 2
    expect(lista.lineas).toHaveLength(2)
  })

  it('marca a los que se retiran hoy', () => {
    const lista = listaDeDesayuno(estadias, '2026-03-12')
    expect(lista.totalSeRetiran).toBe(1)
    expect(lista.lineas.find((l) => l.unidad === 'CAB-2')?.seRetiraHoy).toBe(true)
  })

  it('ordena por unidad con orden natural, como se recorre el salón', () => {
    const lista = listaDeDesayuno(estadias, '2026-03-13')
    // HAB-2 antes que HAB-10: alfabético puro pondría HAB-10 primero.
    expect(lista.lineas.map((l) => l.unidad)).toEqual(['HAB-10', 'HAB-2'].sort((a, b) =>
      a.localeCompare(b, 'es', { numeric: true }),
    ))
  })

  it('nunca cuenta menos de un cubierto', () => {
    const lista = listaDeDesayuno(
      [{ reservaCodigo: 'R-9', unidad: 'HAB-1', huesped: 'X', checkIn: '2026-03-10', checkOut: '2026-03-12', huespedes: 0 }],
      '2026-03-11',
    )
    expect(lista.totalCubiertos).toBe(1)
  })

  it('un día sin nadie devuelve lista vacía, no rompe', () => {
    const lista = listaDeDesayuno(estadias, '2026-01-01')
    expect(lista.lineas).toHaveLength(0)
    expect(lista.totalCubiertos).toBe(0)
  })
})

describe('resumenDeVentas', () => {
  const consumos: ConsumoVendido[] = [
    { productoCodigo: 'DES-EXTRA', productoNombre: 'Desayuno adicional', categoria: 'desayuno', cantidad: 2, precioUnitario: 12, fecha: '2026-03-10' },
    { productoCodigo: 'FRI-AGUA', productoNombre: 'Agua', categoria: 'frigobar', cantidad: 3, precioUnitario: 2.5, fecha: '2026-03-10' },
    { productoCodigo: 'FRI-AGUA', productoNombre: 'Agua', categoria: 'frigobar', cantidad: 1, precioUnitario: 2.5, fecha: '2026-03-11' },
    { productoCodigo: 'EXC-GLA', productoNombre: 'Glaciar', categoria: 'excursion', cantidad: 2, precioUnitario: 80, fecha: '2026-03-15' },
  ]

  it('agrupa el mismo producto vendido en días distintos', () => {
    const r = resumenDeVentas(consumos, '2026-03-10', '2026-03-11')
    const agua = r.lineas.find((l) => l.productoCodigo === 'FRI-AGUA')
    expect(agua?.cantidad).toBe(4)
    expect(agua?.total).toBe(10)
  })

  it('deja afuera lo que cae fuera del rango', () => {
    const r = resumenDeVentas(consumos, '2026-03-10', '2026-03-11')
    expect(r.lineas.find((l) => l.productoCodigo === 'EXC-GLA')).toBeUndefined()
  })

  it('incluye los dos extremos del rango', () => {
    const r = resumenDeVentas(consumos, '2026-03-15', '2026-03-15')
    expect(r.lineas).toHaveLength(1)
    expect(r.dias).toBe(1)
  })

  it('ordena de mayor a menor facturación', () => {
    const r = resumenDeVentas(consumos, '2026-03-10', '2026-03-15')
    expect(r.lineas[0].productoCodigo).toBe('EXC-GLA') // 160
    expect(r.lineas.map((l) => l.total)).toEqual([...r.lineas.map((l) => l.total)].sort((a, b) => b - a))
  })

  it('totaliza por categoría', () => {
    const r = resumenDeVentas(consumos, '2026-03-10', '2026-03-15')
    const frigobar = r.porCategoria.find((c) => c.categoria === 'frigobar')
    expect(frigobar?.cantidad).toBe(4)
    expect(frigobar?.total).toBe(10)
  })

  it('el total general es la suma de las líneas', () => {
    const r = resumenDeVentas(consumos, '2026-03-10', '2026-03-15')
    expect(r.totalGeneral).toBe(24 + 10 + 160)
    expect(r.totalUnidades).toBe(8)
  })

  it('un período sin ventas devuelve ceros, no NaN', () => {
    const r = resumenDeVentas(consumos, '2026-01-01', '2026-01-31')
    expect(r.totalGeneral).toBe(0)
    expect(r.totalUnidades).toBe(0)
    expect(r.lineas).toHaveLength(0)
  })

  it('no arrastra error de punto flotante en los importes', () => {
    const centavos: ConsumoVendido[] = [
      { productoCodigo: 'X', productoNombre: 'X', categoria: 'otro', cantidad: 3, precioUnitario: 0.1, fecha: '2026-03-10' },
    ]
    expect(resumenDeVentas(centavos, '2026-03-10', '2026-03-10').totalGeneral).toBe(0.3)
  })
})
