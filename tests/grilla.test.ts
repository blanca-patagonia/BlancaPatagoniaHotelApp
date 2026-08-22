import { describe, it, expect } from 'vitest'
import {
  claveEstado,
  resumenPorDia,
  tonoOcupacion,
  totalesDeVentana,
  type EstadiaGrilla,
} from '@/lib/domain/grilla'
import { listaDias } from '@/lib/fechas'

/**
 * La fila resumen de la grilla es el dato que recepción mira para saber si la
 * noche está vendida. Lo que se prueba acá, sobre todo, es el borde del día de
 * salida: contarlo como noche ocupada es el error clásico de este tipo de grilla
 * e infla la ocupación tanto como la rotación del hotel.
 */

/** Estadía del 10 al 13: ocupa las noches del 10, 11 y 12. */
function estadia(
  unidadId: string,
  desde: string,
  hasta: string,
  huespedes = 2,
  estado: EstadiaGrilla['estado'] = 'confirmada',
): EstadiaGrilla {
  return { unidadId, periodo: { desde, hasta }, estado, huespedes }
}

const DIAS = listaDias('2026-09-10', 5) // 10, 11, 12, 13, 14

describe('claveEstado', () => {
  it('da una letra distinta a cada estado activo', () => {
    // Es lo que hace que la grilla no comunique con color solamente: para una de
    // cada doce personas con daltonismo, cuatro bloques de colores son cuatro
    // bloques iguales.
    const claves = ['pendiente', 'confirmada', 'pagada', 'in_house'].map(claveEstado)
    expect(claves).toEqual(['P', 'C', '$', 'H'])
    expect(new Set(claves).size).toBe(4)
  })

  it('un estado sin mapear no rompe la grilla', () => {
    expect(claveEstado('cualquier_cosa')).toBe('•')
  })
})

describe('resumenPorDia — el día de salida', () => {
  it('la noche del check-out NO cuenta como ocupada', () => {
    // Del 10 al 13 son tres noches: 10, 11 y 12. El 13 la unidad está libre
    // porque el huésped desocupó a las 10 de la mañana.
    const r = resumenPorDia(DIAS, 1, [estadia('u1', '2026-09-10', '2026-09-13')])

    expect(r.map((d) => d.ocupadas)).toEqual([1, 1, 1, 0, 0])
    expect(r.map((d) => d.libres)).toEqual([0, 0, 0, 1, 1])
  })

  it('la salida se cuenta el día del check-out', () => {
    const r = resumenPorDia(DIAS, 1, [estadia('u1', '2026-09-10', '2026-09-13')])
    expect(r.map((d) => d.salidas)).toEqual([0, 0, 0, 1, 0])
  })

  it('la llegada se cuenta el día del check-in', () => {
    const r = resumenPorDia(DIAS, 1, [estadia('u1', '2026-09-10', '2026-09-13')])
    expect(r.map((d) => d.llegadas)).toEqual([1, 0, 0, 0, 0])
  })

  it('el pax tampoco suma la noche de salida', () => {
    const r = resumenPorDia(DIAS, 1, [estadia('u1', '2026-09-10', '2026-09-13', 3)])
    expect(r.map((d) => d.pax)).toEqual([3, 3, 3, 0, 0])
  })

  it('una unidad que se desocupa y se vuelve a ocupar el mismo día no queda libre', () => {
    // Caso real de temporada alta: sale uno a las 10 y entra otro a las 15. Esa
    // noche la unidad está ocupada, y el día registra una salida Y una llegada.
    const r = resumenPorDia(DIAS, 1, [
      estadia('u1', '2026-09-10', '2026-09-13'),
      estadia('u1', '2026-09-13', '2026-09-15'),
    ])

    const dia13 = r[3]
    expect(dia13.ocupadas).toBe(1)
    expect(dia13.libres).toBe(0)
    expect(dia13.salidas).toBe(1)
    expect(dia13.llegadas).toBe(1)
  })
})

describe('resumenPorDia — ocupación', () => {
  it('cuenta unidades ocupadas y libres contra el total', () => {
    const r = resumenPorDia(DIAS, 4, [
      estadia('u1', '2026-09-10', '2026-09-12'),
      estadia('u2', '2026-09-10', '2026-09-15'),
    ])

    expect(r[0]).toMatchObject({ ocupadas: 2, libres: 2, ocupacionPct: 50 })
    expect(r[2]).toMatchObject({ ocupadas: 1, libres: 3, ocupacionPct: 25 })
  })

  it('redondea el porcentaje a entero', () => {
    // 1 de 3 = 33,33 %
    const r = resumenPorDia(['2026-09-10'], 3, [estadia('u1', '2026-09-10', '2026-09-11')])
    expect(r[0].ocupacionPct).toBe(33)
  })

  it('sin unidades activas no divide por cero', () => {
    const r = resumenPorDia(DIAS, 0, [])
    expect(r.every((d) => d.ocupacionPct === 0 && d.libres === 0)).toBe(true)
  })

  it('un día sin nada da todo en cero y las unidades libres', () => {
    const r = resumenPorDia(['2026-09-10'], 5, [])
    expect(r[0]).toEqual({
      dia: '2026-09-10',
      ocupadas: 0,
      libres: 5,
      pax: 0,
      llegadas: 0,
      salidas: 0,
      ocupacionPct: 0,
    })
  })

  it('la ocupación nunca pasa del 100 % aunque los datos vengan mal', () => {
    // La restricción de exclusión GiST (ADR 0002) impide dos estadías activas
    // solapadas sobre la misma unidad, pero esta función no depende de esa
    // garantía para dar un número coherente.
    const r = resumenPorDia(['2026-09-10'], 1, [
      estadia('u1', '2026-09-10', '2026-09-12'),
      estadia('u1', '2026-09-10', '2026-09-12'),
    ])

    expect(r[0].ocupadas).toBe(1)
    expect(r[0].ocupacionPct).toBe(100)
    expect(r[0].libres).toBe(0)
    // El pax sí se suma: son personas distintas realmente alojadas.
    expect(r[0].pax).toBe(4)
  })

  it('una estadía que empieza antes de la ventana igual cuenta', () => {
    // Es lo normal al mirar la grilla un miércoles: hay gente que llegó el lunes.
    const r = resumenPorDia(DIAS, 2, [estadia('u1', '2026-09-01', '2026-09-12')])

    expect(r[0].ocupadas).toBe(1)
    // Pero su llegada no se cuenta: fue fuera de la ventana.
    expect(r[0].llegadas).toBe(0)
  })

  it('una estadía enteramente fuera de la ventana no aporta nada', () => {
    const r = resumenPorDia(DIAS, 2, [estadia('u1', '2026-10-01', '2026-10-05')])
    expect(r.every((d) => d.ocupadas === 0 && d.llegadas === 0 && d.salidas === 0)).toBe(true)
  })
})

describe('tonoOcupacion', () => {
  it('marca completo solo al 100 %', () => {
    expect(tonoOcupacion(100)).toBe('completo')
    expect(tonoOcupacion(99)).toBe('alto')
  })

  it('marca alto a partir del 85 %, que es el umbral de dejar de dar descuentos', () => {
    expect(tonoOcupacion(85)).toBe('alto')
    expect(tonoOcupacion(84)).toBe('normal')
  })

  it('el resto es normal', () => {
    expect(tonoOcupacion(0)).toBe('normal')
    expect(tonoOcupacion(50)).toBe('normal')
  })
})

describe('totalesDeVentana', () => {
  it('sale de la misma cuenta que la fila diaria', () => {
    // Si los indicadores de arriba y la fila de abajo salieran de dos cuentas
    // distintas, tarde o temprano mostrarían números que no cierran y el usuario
    // no tendría forma de saber cuál creer.
    const resumen = resumenPorDia(DIAS, 2, [
      estadia('u1', '2026-09-10', '2026-09-13'),
      estadia('u2', '2026-09-11', '2026-09-12'),
    ])
    const t = totalesDeVentana(resumen)

    // u1: noches 10, 11, 12 = 3 · u2: noche 11 = 1 → 4 noches ocupadas
    expect(t.nochesOcupadas).toBe(4)
    expect(t.nochesDisponibles).toBe(10) // 2 unidades × 5 días
    expect(t.ocupacionPct).toBe(40)
    expect(t.llegadas).toBe(2)
    expect(t.salidas).toBe(2)
  })

  it('señala el día más cargado', () => {
    const resumen = resumenPorDia(DIAS, 2, [
      estadia('u1', '2026-09-10', '2026-09-13'),
      estadia('u2', '2026-09-11', '2026-09-12'),
    ])
    const t = totalesDeVentana(resumen)

    // El 11 están las dos unidades ocupadas.
    expect(t.diaMasCargado?.dia).toBe('2026-09-11')
    expect(t.diaMasCargado?.ocupacionPct).toBe(100)
  })

  it('una ventana vacía no rompe ni inventa un día', () => {
    const t = totalesDeVentana([])
    expect(t).toEqual({
      nochesOcupadas: 0,
      nochesDisponibles: 0,
      ocupacionPct: 0,
      llegadas: 0,
      salidas: 0,
      diaMasCargado: null,
    })
  })
})
