import { describe, it, expect } from 'vitest'
import {
  SIN_CLASIFICAR,
  opcionesDepartamentos,
  resolutorDepartamentos,
  type DepartamentoFila,
} from '@/lib/domain/departamentos'

/**
 * Este módulo existe por un bug que sólo apareció al abrir la pantalla: el embed
 * anidado de PostgREST no resuelve una clave foránea auto-referencial en la
 * dirección del padre —devuelve un array vacío— y la cuenta mostraba
 * «undefined › Bebidas».
 *
 * Los tests fijan el comportamiento correcto para que no se vuelva a intentar
 * resolverlo en la consulta.
 */

const FILAS: DepartamentoFila[] = [
  { id: 'ayb', nombre: 'Alimentos y bebidas', padre_id: null },
  { id: 'fri', nombre: 'Frigobar', padre_id: null },
  { id: 'fri-beb', nombre: 'Bebidas', padre_id: 'fri' },
  { id: 'fri-snk', nombre: 'Snacks', padre_id: 'fri' },
  { id: 'ayb-rest', nombre: 'Restaurante', padre_id: 'ayb' },
]

describe('resolutorDepartamentos', () => {
  const resolver = resolutorDepartamentos(FILAS)

  it('un subdepartamento resuelve su padre', () => {
    // Es el caso que estaba roto: el nombre del padre llegaba undefined.
    expect(resolver('fri-beb')).toEqual({
      departamento: 'Frigobar',
      subdepartamento: 'Bebidas',
      etiqueta: 'Frigobar › Bebidas',
    })
  })

  it('un departamento de primer nivel no inventa subdepartamento', () => {
    expect(resolver('fri')).toEqual({
      departamento: 'Frigobar',
      subdepartamento: '',
      etiqueta: 'Frigobar',
    })
  })

  it('sin departamento devuelve «sin clasificar», no undefined', () => {
    expect(resolver(null)).toEqual(SIN_CLASIFICAR)
    expect(resolver(undefined)).toEqual(SIN_CLASIFICAR)
    expect(resolver('')).toEqual(SIN_CLASIFICAR)
  })

  it('un id que no existe tampoco propaga undefined a la pantalla', () => {
    expect(resolver('no-existe')).toEqual(SIN_CLASIFICAR)
  })

  it('un padre inexistente se trata como primer nivel', () => {
    // No debería pasar (hay FK), pero si pasara, mostrar el nombre propio es mejor
    // que mostrar «undefined ›».
    const huerfano = resolutorDepartamentos([
      { id: 'x', nombre: 'Huérfano', padre_id: 'fantasma' },
    ])
    expect(huerfano('x').etiqueta).toBe('Huérfano')
    expect(huerfano('x').subdepartamento).toBe('')
  })

  it('el índice se arma una sola vez y sirve para muchas filas', () => {
    // La razón de devolver una función en vez de resolver de a una: la cuenta tiene
    // veinte líneas y no puede rearmar el mapa en cada una.
    const r = resolutorDepartamentos(FILAS)
    expect(r('fri-beb').etiqueta).toBe('Frigobar › Bebidas')
    expect(r('ayb-rest').etiqueta).toBe('Alimentos y bebidas › Restaurante')
    expect(r('fri-snk').etiqueta).toBe('Frigobar › Snacks')
  })
})

describe('opcionesDepartamentos', () => {
  it('pone cada subdepartamento debajo de su padre', () => {
    const ops = opcionesDepartamentos(FILAS)
    const etiquetas = ops.map((o) => o.etiqueta)

    expect(etiquetas).toEqual([
      'Alimentos y bebidas',
      'Alimentos y bebidas › Restaurante',
      'Frigobar',
      'Frigobar › Bebidas',
      'Frigobar › Snacks',
    ])
  })

  it('la etiqueta del subdepartamento nombra al padre', () => {
    // En una lista plana, «Bebidas» sola no dice si es del frigobar o del
    // restaurante.
    const ops = opcionesDepartamentos(FILAS)
    expect(ops.find((o) => o.id === 'fri-beb')?.etiqueta).toContain('Frigobar')
  })

  it('no pierde una fila con padre inexistente', () => {
    const ops = opcionesDepartamentos([
      ...FILAS,
      { id: 'raro', nombre: 'Colgado', padre_id: 'fantasma' },
    ])
    expect(ops.map((o) => o.id)).toContain('raro')
  })

  it('no repite ninguna opción', () => {
    const ops = opcionesDepartamentos(FILAS)
    expect(new Set(ops.map((o) => o.id)).size).toBe(ops.length)
  })

  it('una tabla vacía devuelve lista vacía, no error', () => {
    expect(opcionesDepartamentos([])).toEqual([])
  })
})
