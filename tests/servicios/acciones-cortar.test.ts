import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { cortarSiFalla } from '@/lib/acciones'

/**
 * `cortarSiFalla` es el punto por el que pasan todas las escrituras de las
 * acciones que redirigen. Si se equivoca, el fallo vuelve a ser silencioso en
 * todo el panel a la vez, así que conviene fijarlo con tests.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

/** Destino al que redirigió, o `null` si dejó seguir la acción. */
function destinoDe(fn: () => void): string | null {
  try {
    fn()
    return null
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message)
    if (!m) throw e
    return m[1]
  }
}

const logueado: string[] = []
const errorOriginal = console.error

beforeEach(() => {
  logueado.length = 0
  console.error = (...partes: unknown[]) => {
    logueado.push(partes.map(String).join(' '))
  }
})

afterAll(() => {
  console.error = errorOriginal
})

describe('cortarSiFalla', () => {
  it('deja seguir la acción cuando no hubo error', () => {
    expect(destinoDe(() => cortarSiFalla(null, '/panel/huespedes', 'borrar'))).toBeNull()
    expect(destinoDe(() => cortarSiFalla(undefined, '/panel/huespedes', 'borrar'))).toBeNull()
    expect(logueado).toHaveLength(0)
  })

  it('redirige con el motivo cuando la escritura falló', () => {
    const destino = destinoDe(() =>
      cortarSiFalla({ message: 'permission denied' }, '/panel/huespedes', 'borrar'),
    )
    expect(destino).toBe('/panel/huespedes?error=borrar')
  })

  it('usa «guardar» como motivo por defecto', () => {
    const destino = destinoDe(() => cortarSiFalla({ message: 'boom' }, '/panel/reservas'))
    expect(destino).toBe('/panel/reservas?error=guardar')
  })

  it('usa & cuando el destino ya trae query string', () => {
    // Algunas pantallas redirigen con un filtro en la URL (`?canal=…`). Con `?`
    // fijo la URL saldría rota y se perdería ese contexto.
    const destino = destinoDe(() =>
      cortarSiFalla({ message: 'boom' }, '/panel/reservas?canal=abc', 'mensaje'),
    )
    expect(destino).toBe('/panel/reservas?canal=abc&error=mensaje')
  })

  it('manda el mensaje real de la base al log del servidor, no a la URL', () => {
    // Al usuario le sirve saber qué operación falló; el detalle técnico es para
    // diagnosticar. Y sin log la causa se perdería del todo.
    const destino = destinoDe(() =>
      cortarSiFalla(
        { message: 'duplicate key value violates unique constraint "avisos_pkey"' },
        '/panel/huespedes',
        'borrar',
      ),
    )
    expect(destino).not.toContain('duplicate key')
    expect(logueado.join('\n')).toContain('duplicate key value violates unique constraint')
    expect(logueado.join('\n')).toContain('borrar')
  })
})
