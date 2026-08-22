import { describe, it, expect } from 'vitest'
import {
  firmaEncabezados,
  muestraDeColumnas,
  resolverIndices,
  validarAsignaciones,
} from '@/lib/domain/mapeo-columnas'
import { esColumnaProhibida, normalizarEncabezado } from '@/lib/canales/csv'

const norm = normalizarEncabezado
const CAMPOS = ['externalId', 'huesped', 'checkIn', 'checkOut', 'notas'] as const

describe('mapeo de columnas · huella del formato', () => {
  it('el mismo archivo da la misma huella', () => {
    const a = ['Número de reserva', 'Nombre del cliente', 'Fecha de entrada']
    expect(firmaEncabezados(a, norm)).toBe(firmaEncabezados([...a], norm))
  })

  it('reordenar las columnas NO cambia la huella', () => {
    // A propósito: el mapeo resuelve por nombre, así que un reordenamiento sigue
    // siendo el mismo formato. Con la huella sin ordenar, volvería a preguntar por
    // algo que ya está resuelto.
    const a = ['Ref', 'Cliente', 'Llegó el']
    const b = ['Cliente', 'Llegó el', 'Ref']
    expect(firmaEncabezados(a, norm)).toBe(firmaEncabezados(b, norm))
  })

  it('agregar una columna SÍ cambia la huella', () => {
    const a = ['Ref', 'Cliente']
    expect(firmaEncabezados(a, norm)).not.toBe(firmaEncabezados([...a, 'Nuevo'], norm))
  })

  it('ignora las columnas que el normalizador dejó vacías', () => {
    // Las prohibidas llegan en blanco desde el lector: no forman parte del formato.
    expect(firmaEncabezados(['Ref', '', 'Cliente'], norm)).toBe(
      firmaEncabezados(['Ref', 'Cliente'], norm),
    )
  })
})

describe('mapeo de columnas · resolver índices', () => {
  const encabezados = ['Ref', 'Cliente final', 'Llegó el', 'Se fue el', 'Comentarios']
  const propuesta = {
    externalId: null,
    huesped: null,
    checkIn: null,
    checkOut: null,
    notas: 4, // el diccionario sí acertó «Comentarios»
  }

  it('sin mapeo guardado devuelve la propuesta intacta', () => {
    const r = resolverIndices(propuesta, null, encabezados, norm)
    expect(r.indices).toEqual(propuesta)
    expect(r.desaparecidas).toEqual([])
  })

  it('el mapeo guardado resuelve lo que el diccionario no pudo', () => {
    const r = resolverIndices(
      propuesta,
      { externalId: 'ref', huesped: 'cliente final', checkIn: 'llego el' },
      encabezados,
      norm,
    )
    expect(r.indices.externalId).toBe(0)
    expect(r.indices.huesped).toBe(1)
    expect(r.indices.checkIn).toBe(2)
    // Lo que el mapeo no menciona lo sigue cubriendo el diccionario.
    expect(r.indices.notas).toBe(4)
  })

  it('el mapeo guardado GANA sobre la propuesta', () => {
    // Es una afirmación de alguien que miró el archivo; la propuesta es una
    // heurística. Si una persona dijo que «Ref» es el número de reserva, el
    // diccionario no tiene que discutirlo.
    const r = resolverIndices({ ...propuesta, notas: 4 }, { notas: 'ref' }, encabezados, norm)
    expect(r.indices.notas).toBe(0)
  })

  it('SOBREVIVE a que el extranet agregue una columna al medio', () => {
    // El caso que decide todo el diseño. Con un mapeo por índice, esto quedaría
    // corrido un lugar EN SILENCIO y las fechas se leerían de otra columna.
    const conColumnaNueva = ['Ref', 'Nueva columna', 'Cliente final', 'Llegó el', 'Se fue el']
    const guardado = { externalId: 'ref', huesped: 'cliente final', checkIn: 'llego el' }

    const r = resolverIndices(
      { externalId: null, huesped: null, checkIn: null, checkOut: null, notas: null },
      guardado,
      conColumnaNueva,
      norm,
    )
    expect(r.indices.huesped).toBe(2)
    expect(r.indices.checkIn).toBe(3)
    expect(r.desaparecidas).toEqual([])
  })

  it('avisa cuando una columna del mapeo guardado YA NO ESTÁ', () => {
    // Se informa aparte de «no encontrado» porque es más accionable: el formato
    // cambió y hay que volver a mapear. Sin la distinción, el usuario vería «faltan
    // columnas» sobre un archivo que él mismo mapeó bien el mes pasado.
    const r = resolverIndices(
      { externalId: null, huesped: null, checkIn: null, checkOut: null, notas: null },
      { externalId: 'ref', huesped: 'columna que ya no existe' },
      encabezados,
      norm,
    )
    expect(r.indices.externalId).toBe(0)
    expect(r.desaparecidas).toEqual([{ campo: 'huesped', encabezado: 'columna que ya no existe' }])
  })

  it('ignora un campo del mapeo que el lector ya no conoce', () => {
    // El mapeo guardado puede ser más viejo que el código.
    const r = resolverIndices(propuesta, { campoInventado: 'ref' }, encabezados, norm)
    expect(r.indices).toEqual(propuesta)
  })
})

describe('mapeo de columnas · validar lo que llega del formulario', () => {
  const encabezados = ['Ref', 'Cliente final', 'Llegó el', 'Tarjeta virtual', 'CVC']

  it('acepta un mapeo correcto y lo devuelve normalizado', () => {
    const r = validarAsignaciones(
      { externalId: 'Ref', huesped: 'Cliente final' },
      CAMPOS,
      encabezados,
      esColumnaProhibida,
      norm,
    )
    expect(r.ok).toBe(true)
    expect(r.limpias).toEqual({ externalId: 'ref', huesped: 'cliente final' })
  })

  it('un campo vacío significa «no asignar» y es legítimo', () => {
    const r = validarAsignaciones({ externalId: 'Ref', notas: '' }, CAMPOS, encabezados, esColumnaProhibida, norm)
    expect(r.ok).toBe(true)
    expect(r.limpias.notas).toBeUndefined()
  })

  it('RECHAZA asignar una columna de datos de tarjeta', () => {
    // La razón principal de que esta función exista. El mapeo manual le da al usuario
    // exactamente la capacidad que el lector le niega: elegir qué columna se lee. Sin
    // esto, un PAN entraría a la base por una pantalla de configuración.
    const r = validarAsignaciones(
      { notas: 'Tarjeta virtual' },
      CAMPOS,
      encabezados,
      esColumnaProhibida,
      norm,
    )
    expect(r.ok).toBe(false)
    expect(r.limpias.notas).toBeUndefined()
    expect(r.motivos.join(' ')).toContain('Tarjeta virtual')
  })

  it('rechaza también el CVC', () => {
    const r = validarAsignaciones({ notas: 'CVC' }, CAMPOS, encabezados, esColumnaProhibida, norm)
    expect(r.ok).toBe(false)
  })

  it('rechaza un campo que el importador no conoce', () => {
    const r = validarAsignaciones(
      { campoInventado: 'Ref' },
      CAMPOS,
      encabezados,
      esColumnaProhibida,
      norm,
    )
    expect(r.ok).toBe(false)
    expect(r.limpias).toEqual({})
  })

  it('rechaza una columna que no está en el archivo', () => {
    const r = validarAsignaciones(
      { externalId: 'Columna inventada' },
      CAMPOS,
      encabezados,
      esColumnaProhibida,
      norm,
    )
    expect(r.ok).toBe(false)
    expect(r.motivos.join(' ')).toContain('no está en el archivo')
  })

  it('rechaza dos campos apuntando a la misma columna', () => {
    // Casi siempre es un error de quien mapeó, y produce datos duplicados que después
    // nadie entiende.
    const r = validarAsignaciones(
      { externalId: 'Ref', huesped: 'Ref' },
      CAMPOS,
      encabezados,
      esColumnaProhibida,
      norm,
    )
    expect(r.ok).toBe(false)
    expect(r.motivos.join(' ')).toContain('dos campos a la vez')
  })
})

describe('mapeo de columnas · muestra de valores', () => {
  const filas = [
    ['Ref', 'Cliente', 'Llegó el'],
    ['1234567890', 'Pérez, Ana', '25/09/2026'],
    ['1234567891', '', '26/09/2026'],
    ['1234567892', 'Gómez, Luis', '27/09/2026'],
    ['1234567893', 'Díaz, Sol', '28/09/2026'],
  ]

  it('toma hasta tres valores por columna, sin el encabezado', () => {
    const m = muestraDeColumnas(filas, 3)
    expect(m[0]).toEqual(['1234567890', '1234567891', '1234567892'])
    expect(m[2]).toEqual(['25/09/2026', '26/09/2026', '27/09/2026'])
  })

  it('saltea las celdas vacías', () => {
    // Una columna con huecos arriba mostraría ejemplos en blanco, que es no mostrar
    // nada — y los ejemplos son lo que permite decidir a quien no reconoce el
    // encabezado de su propio export.
    const m = muestraDeColumnas(filas, 3)
    expect(m[1]).toEqual(['Pérez, Ana', 'Gómez, Luis', 'Díaz, Sol'])
  })

  it('una columna entera vacía devuelve una muestra vacía, no undefined', () => {
    const m = muestraDeColumnas([['A', 'B'], ['1', ''], ['2', '']], 2)
    expect(m[1]).toEqual([])
  })

  it('un archivo con solo encabezados no rompe', () => {
    expect(muestraDeColumnas([['A', 'B']], 2)).toEqual([[], []])
  })

  it('recorta los valores muy largos', () => {
    const largo = 'x'.repeat(200)
    const m = muestraDeColumnas([['A'], [largo]], 1)
    expect(m[0][0].length).toBeLessThanOrEqual(40)
  })
})
