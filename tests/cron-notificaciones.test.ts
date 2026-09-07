import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * El cron que despacha la bandeja de salida.
 *
 * Como los otros dos, escribe con `service_role` y lo único que lo protege es un
 * secreto en una cabecera: lo que hay que probar es que **rechace**. El despacho
 * en sí lo cubre `tests/notificaciones-bandeja.test.ts` contra la base.
 */

const SECRETO = 'secreto-de-prueba'

let despachos = 0
let limiteRecibido = 0
let explota = false

vi.mock('@/lib/supabase/admin', () => ({ crearClienteAdmin: () => ({}) }))
vi.mock('@/lib/registro', () => ({
  registrarError: async () => {},
  registrarInfo: async () => {},
}))
vi.mock('@/lib/notificaciones', () => ({
  despachar: async (_c: unknown, limite: number) => {
    despachos += 1
    limiteRecibido = limite
    if (explota) throw new Error('la bandeja explotó')
    return { tomadas: 3, enviadas: 2, reintentar: 1, fallidas: 0 }
  },
}))

function pedido(cabecera?: string): Request {
  return new Request('https://h.local/api/cron/notificaciones', {
    method: 'POST',
    headers: cabecera ? { authorization: cabecera } : {},
  })
}

describe('cron de notificaciones', () => {
  beforeEach(() => {
    despachos = 0
    limiteRecibido = 0
    explota = false
    vi.stubEnv('CRON_SECRET', SECRETO)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('sin CRON_SECRET no despacha nada', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const { POST } = await import('@/app/api/cron/notificaciones/route')

    expect((await POST(pedido(`Bearer ${SECRETO}`))).status).toBe(503)
    expect(despachos, 'despachó sin estar configurado').toBe(0)
  })

  it('rechaza un secreto que no coincide', async () => {
    const { POST } = await import('@/app/api/cron/notificaciones/route')

    expect((await POST(pedido('Bearer otro'))).status).toBe(401)
    expect(despachos, 'despachó sin autorización').toBe(0)
  })

  it('con el secreto correcto despacha y devuelve el resumen', async () => {
    const { POST } = await import('@/app/api/cron/notificaciones/route')

    const r = await POST(pedido(`Bearer ${SECRETO}`))
    const cuerpo = (await r.json()) as { ok: boolean; enviadas: number; reintentar: number }

    expect(r.status).toBe(200)
    expect(despachos).toBe(1)
    expect(cuerpo.enviadas).toBe(2)
    expect(cuerpo.reintentar).toBe(1)
  })

  /*
    El límite por corrida no es un detalle de rendimiento: sin él, una bandeja
    acumulada por un corte largo del proveedor haría que la función se pase del
    `maxDuration` y no termine NINGUNA.
  */
  it('acota cuánto procesa por corrida', async () => {
    const { POST } = await import('@/app/api/cron/notificaciones/route')
    await POST(pedido(`Bearer ${SECRETO}`))

    expect(limiteRecibido, 'despachó sin límite').toBeGreaterThan(0)
    expect(limiteRecibido).toBeLessThanOrEqual(100)
  })

  it('si el despacho explota devuelve 500 para que se reintente', async () => {
    explota = true
    const { POST } = await import('@/app/api/cron/notificaciones/route')

    // 500 y no 200: la bandeja no perdió nada, las filas siguen pendientes, así
    // que reintentar es correcto y no duplica.
    expect((await POST(pedido(`Bearer ${SECRETO}`))).status).toBe(500)
  })
})
