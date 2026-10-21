import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchConCorte } from '@/lib/supabase/fetch-con-corte'

describe('fetchConCorte · una base colgada no retiene la página', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('corta un pedido que no responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, i?: RequestInit) =>
          new Promise((_ok, falla) => i?.signal?.addEventListener('abort', () => falla(i.signal!.reason))),
      ),
    )
    await expect(fetchConCorte(30)('https://base/rest')).rejects.toBeDefined()
  })

  it('respeta la señal propia de quien llama', async () => {
    const recibido: (AbortSignal | undefined)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, i?: RequestInit) => {
        recibido.push(i?.signal ?? undefined)
        return new Response('ok')
      }),
    )
    const propia = new AbortController()
    await fetchConCorte(10_000)('https://base/rest', { signal: propia.signal })
    propia.abort()
    expect(recibido[0]?.aborted).toBe(true)
  })
})
