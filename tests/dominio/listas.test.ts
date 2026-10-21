import { describe, it, expect } from 'vitest'
import { comoLista, deLista } from '@/lib/domain/listas'

describe('deLista', () => {
  const VISTAS = ['entrantes', 'cobros'] as const

  it('devuelve el valor si está en la lista, con su tipo', () => {
    const v: 'entrantes' | 'cobros' | undefined = deLista(VISTAS, 'cobros')
    expect(v).toBe('cobros')
  })

  it('lo que no está, lo vacío y lo nulo dan undefined', () => {
    expect(deLista(VISTAS, 'otra')).toBeUndefined()
    expect(deLista(VISTAS, '')).toBeUndefined()
    expect(deLista(VISTAS, null)).toBeUndefined()
    expect(deLista(VISTAS, undefined)).toBeUndefined()
  })
})

describe('comoLista (embeds a-uno de PostgREST)', () => {
  it('acepta objeto, null, undefined o arreglo', () => {
    expect(comoLista({ id: 'f1' })).toEqual([{ id: 'f1' }])
    expect(comoLista(null)).toEqual([])
    expect(comoLista(undefined)).toEqual([])
    expect(comoLista([{ id: 'a' }, { id: 'b' }])).toHaveLength(2)
  })
})
