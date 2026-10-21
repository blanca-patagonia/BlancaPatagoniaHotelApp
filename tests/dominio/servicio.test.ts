import { describe, it, expect } from 'vitest'
import {
  desayunaEn,
  listaDeDesayuno,
  resumenDeVentas,
  puedeCargarConsumo,
  motivoNoCargable,
  MENSAJES_NO_CARGABLE,
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

/**
 * Desayuno vendido suelto (P3 del relevamiento del 15/08/2026).
 *
 * «Llegan los huéspedes a las 9 de la mañana, el check-in es recién a las 2 o 3
 * de la tarde, y te dicen si se puede subir a desayunar. Tiene un costo de 15
 * dólares.»
 *
 * Lo que importa acá no es cobrarlo —eso es un consumo más— sino que la COCINA
 * lo cuente. Un cubierto vendido que no aparece en la lista es un desayuno que
 * no se prepara, y es justo el problema que esta pantalla existe para evitar.
 */
describe('desayunos extra vendidos sueltos', () => {
  const estadia: EstadiaServicio = {
    reservaCodigo: 'BP-1',
    unidad: '101',
    huesped: 'Pérez, Ana',
    checkIn: '2026-08-10',
    checkOut: '2026-08-12',
    huespedes: 2,
  }

  it('el extra suma al total de cubiertos que la cocina tiene que preparar', () => {
    const sinExtra = listaDeDesayuno([estadia], '2026-08-11')
    const conExtra = listaDeDesayuno([estadia], '2026-08-11', [
      {
        reservaCodigo: 'BP-2',
        huesped: 'Gómez, Luis',
        unidad: null,
        cubiertos: 2,
        fecha: '2026-08-11',
      },
    ])

    expect(sinExtra.totalCubiertos).toBe(2)
    expect(conExtra.totalCubiertos).toBe(4)
    expect(conExtra.totalExtras).toBe(2)
  })

  it('el extra sin habitación asignada se muestra con guion, no vacío', () => {
    // El huésped llegó antes del check-in: todavía no tiene unidad. Una celda
    // vacía se lee como un dato que falta por error.
    const lista = listaDeDesayuno([], '2026-08-11', [
      {
        reservaCodigo: 'BP-2',
        huesped: 'Gómez, Luis',
        unidad: null,
        cubiertos: 1,
        fecha: '2026-08-11',
      },
    ])
    expect(lista.lineas[0].unidad).toBe('—')
    expect(lista.lineas[0].esExtra).toBe(true)
  })

  it('un extra de OTRA fecha no se cuela en la lista del día', () => {
    const lista = listaDeDesayuno([estadia], '2026-08-11', [
      {
        reservaCodigo: 'BP-2',
        huesped: 'Gómez, Luis',
        unidad: null,
        cubiertos: 5,
        fecha: '2026-08-20',
      },
    ])
    expect(lista.totalExtras).toBe(0)
    expect(lista.totalCubiertos).toBe(2)
  })

  it('las líneas incluidas siguen marcadas como NO extra', () => {
    const lista = listaDeDesayuno([estadia], '2026-08-11')
    expect(lista.lineas[0].esExtra).toBe(false)
    expect(lista.totalExtras).toBe(0)
  })

  it('sin extras, la lista se comporta igual que antes', () => {
    // Garantía de que el parámetro nuevo es opcional y no cambia nada existente.
    const lista = listaDeDesayuno([estadia], '2026-08-11')
    expect(lista.totalCubiertos).toBe(2)
    expect(lista.lineas).toHaveLength(1)
  })
})

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
