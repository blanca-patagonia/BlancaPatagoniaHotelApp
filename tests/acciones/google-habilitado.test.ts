import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * El botón de Google se ofrece solo si GoTrue lo tiene habilitado de verdad.
 *
 * ── Qué bug fija este archivo ───────────────────────────────────────────────
 *
 * `googleHabilitado()` leía `AUTH_GOOGLE_HABILITADO`, una variable de **la app
 * Next**. Pero quien atiende el intercambio OAuth es **GoTrue**, otro servicio con
 * su propia configuración. Eran dos interruptores independientes que tenían que
 * coincidir, y nada verificaba que coincidieran.
 *
 * Con la variable en `1` y el proveedor apagado, el botón aparecía, redirigía a
 * GoTrue y GoTrue devolvía un JSON crudo en pantalla:
 *
 *   {"code":400,"error_code":"validation_failed",
 *    "msg":"Unsupported provider: provider is not enabled"}
 *
 * Sin vuelta atrás y sin explicación. Es el «botón que existe y falla» que el
 * ADR 0018 dice que no hay que tener.
 *
 * El primer caso de este archivo es el que fallaba antes del arreglo.
 *
 * No toca la base, así que no lleva `skipIf(!hayDB)`: lo único que hace falta es
 * poder responder por `fetch` en lugar de GoTrue.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock('@/lib/supabase/server', () => ({ crearClienteServidor: async () => ({}) }))
vi.mock('@/lib/limites', () => ({ permitirIntento: async () => true }))

/** Responde como lo haría `/auth/v1/settings` de GoTrue. */
function gotrueResponde(externos: Record<string, boolean>) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ external: externos }),
  })) as unknown as typeof fetch
}

describe('googleHabilitado · el botón sale de lo que dice GoTrue, no de una variable', () => {
  const entornoOriginal = { ...process.env }

  beforeEach(() => {
    // Valores mínimos para que `envPublico()` valide.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'clave-de-prueba'
    delete process.env.AUTH_GOOGLE_HABILITADO
  })

  afterEach(() => {
    process.env = { ...entornoOriginal }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('NO ofrece el botón si GoTrue tiene el proveedor apagado, aunque la variable diga que sí', async () => {
    // Éste es el caso que producía la pantalla de JSON.
    process.env.AUTH_GOOGLE_HABILITADO = '1'
    vi.stubGlobal('fetch', gotrueResponde({ google: false, email: true }))

    const { googleHabilitado } = await import('@/app/login/actions')
    expect(await googleHabilitado()).toBe(false)
  })

  it('ofrece el botón cuando GoTrue informa el proveedor habilitado', async () => {
    vi.stubGlobal('fetch', gotrueResponde({ google: true, email: true }))

    const { googleHabilitado } = await import('@/app/login/actions')
    expect(await googleHabilitado()).toBe(true)
  })

  it('no hace falta ninguna variable para encenderlo: alcanza con que GoTrue lo tenga', async () => {
    // Antes esto daba `false` y el botón no aparecía nunca aunque funcionara.
    delete process.env.AUTH_GOOGLE_HABILITADO
    vi.stubGlobal('fetch', gotrueResponde({ google: true }))

    const { googleHabilitado } = await import('@/app/login/actions')
    expect(await googleHabilitado()).toBe(true)
  })

  it('AUTH_GOOGLE_HABILITADO=0 apaga el botón aunque GoTrue lo tenga habilitado', async () => {
    // El interruptor sigue existiendo, pero solo para apagar: es lo que le permite
    // al hotel esconderlo sin tocar la configuración de Supabase.
    process.env.AUTH_GOOGLE_HABILITADO = '0'
    const espia = gotrueResponde({ google: true })
    vi.stubGlobal('fetch', espia)

    const { googleHabilitado } = await import('@/app/login/actions')
    expect(await googleHabilitado()).toBe(false)
    // Y ni siquiera pregunta: el apagado explícito corta antes.
    expect(espia).not.toHaveBeenCalled()
  })

  it('falla CERRADO si GoTrue no responde', async () => {
    // Un botón que falta se nota y se pregunta. Uno que rompe deja a alguien
    // trabado en una pantalla de JSON sin vuelta atrás.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('sin conexión')
      }) as unknown as typeof fetch,
    )

    const { googleHabilitado } = await import('@/app/login/actions')
    expect(await googleHabilitado()).toBe(false)
  })

  it('falla cerrado también si GoTrue contesta con un error HTTP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch,
    )

    const { googleHabilitado } = await import('@/app/login/actions')
    expect(await googleHabilitado()).toBe(false)
  })
})
