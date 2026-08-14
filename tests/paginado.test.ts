import { describe, it, expect } from 'vitest'
import { traerTodo } from '@/lib/paginado'

/**
 * `max_rows = 1000` (supabase/config.toml:10) recorta TODA respuesta de PostgREST
 * sin error y sin aviso. Es el techo que hacía que las exportaciones a CSV
 * salieran con mil filas pese a declarar 5000, y que los reportes gerenciales
 * agregaran sobre datos incompletos.
 *
 * Estos tests usan una fuente simulada porque lo que se prueba es el recorrido
 * por tramos, no la base.
 */

/** Simula una tabla con `n` filas, respetando el techo de 1000 por respuesta. */
function tablaDe(n: number) {
  const todas = Array.from({ length: n }, (_, i) => ({ id: i }))
  return (desde: number, hasta: number) =>
    Promise.resolve({ data: todas.slice(desde, hasta + 1).slice(0, 1000), error: null })
}

describe('traerTodo', () => {
  it('trae una tabla que entra en un solo tramo', async () => {
    const { filas, truncado, error } = await traerTodo(tablaDe(42))
    expect(filas).toHaveLength(42)
    expect(truncado).toBe(false)
    expect(error).toBeNull()
  })

  it('supera el techo de mil filas de PostgREST', async () => {
    // Es el caso que fallaba: con `.limit(5000)` la respuesta llegaba con 1000.
    const { filas, truncado } = await traerTodo(tablaDe(2500))
    expect(filas).toHaveLength(2500)
    expect(truncado).toBe(false)
  })

  it('el borde exacto de mil no pide un tramo de más de la cuenta', async () => {
    const { filas, truncado } = await traerTodo(tablaDe(1000))
    expect(filas).toHaveLength(1000)
    expect(truncado).toBe(false)
  })

  it('una tabla vacía no rompe', async () => {
    const { filas, truncado } = await traerTodo(tablaDe(0))
    expect(filas).toHaveLength(0)
    expect(truncado).toBe(false)
  })

  it('avisa cuando corta por el techo, en vez de truncar en silencio', async () => {
    const { filas, truncado } = await traerTodo(tablaDe(5000), 2000)
    expect(filas).toHaveLength(2000)
    expect(truncado).toBe(true)
  })

  it('devuelve el error de la base y lo que alcanzó a traer', async () => {
    let llamadas = 0
    const conFalla = (desde: number) => {
      llamadas += 1
      if (llamadas > 1) return Promise.resolve({ data: null, error: { message: 'se cayó' } })
      return Promise.resolve({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: desde + i })),
        error: null,
      })
    }
    const { filas, truncado, error } = await traerTodo(conFalla)
    expect(filas).toHaveLength(1000)
    expect(truncado).toBe(true)
    expect(error).toBe('se cayó')
  })
})
