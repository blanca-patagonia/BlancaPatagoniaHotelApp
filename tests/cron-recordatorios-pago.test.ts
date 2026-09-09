import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * El cron de recordatorio de seña pendiente.
 *
 * Como los otros crons, lo primero que hay que probar es que **rechace** sin
 * el secreto correcto. La consulta contra `reservas` se simula acá porque no
 * hay base local en CI sin Docker; el cálculo de saldo (`resumenPagos`) es
 * real y puro, así que vale la pena ejercitarlo con casos de pagos reales.
 */

const SECRETO = 'secreto-de-prueba'

let encolados: { entidadId: string; variables: Record<string, unknown> }[] = []
let filas: unknown[] = []
let consultaFalla = false

vi.mock('@/lib/supabase/admin', () => ({
  crearClienteAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          lte: async () => (consultaFalla ? { data: null, error: { message: 'x' } } : { data: filas, error: null }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/registro', () => ({
  registrarError: async () => {},
  registrarInfo: async () => {},
}))
vi.mock('@/lib/notificaciones', () => ({
  encolar: async (_c: unknown, p: { entidadId: string; variables: Record<string, unknown> }) => {
    encolados.push(p)
    return { ok: true }
  },
}))

function pedido(cabecera?: string): Request {
  return new Request('https://h.local/api/cron/recordatorios-pago', {
    method: 'POST',
    headers: cabecera ? { authorization: cabecera } : {},
  })
}

function reserva(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r1',
    codigo: 'BP-1',
    total: '500',
    token: 'tok-1',
    huesped_id: 'h1',
    huesped: { nombre: 'Ana', apellido: 'Gómez', email: 'ana@x.com' },
    pagos: [],
    ...over,
  }
}

describe('cron de recordatorios de pago', () => {
  beforeEach(() => {
    encolados = []
    filas = []
    consultaFalla = false
    vi.stubEnv('CRON_SECRET', SECRETO)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('sin CRON_SECRET no consulta nada', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const { POST } = await import('@/app/api/cron/recordatorios-pago/route')
    const res = await POST(pedido())
    expect(res.status).toBe(503)
    expect(encolados).toHaveLength(0)
  })

  it('rechaza sin el secreto correcto', async () => {
    const { POST } = await import('@/app/api/cron/recordatorios-pago/route')
    const res = await POST(pedido('Bearer otra-cosa'))
    expect(res.status).toBe(401)
    expect(encolados).toHaveLength(0)
  })

  it('500 si la consulta a reservas falla', async () => {
    consultaFalla = true
    const { POST } = await import('@/app/api/cron/recordatorios-pago/route')
    const res = await POST(pedido(`Bearer ${SECRETO}`))
    expect(res.status).toBe(500)
  })

  it('encola el recordatorio con el saldo total cuando no pagó nada', async () => {
    filas = [reserva()]
    const { POST } = await import('@/app/api/cron/recordatorios-pago/route')
    const res = await POST(pedido(`Bearer ${SECRETO}`))
    const body = (await res.json()) as { ok: boolean; encoladas: number }
    expect(body.encoladas).toBe(1)
    expect(encolados[0].entidadId).toBe('r1')
    expect(encolados[0].variables.total).toBe('USD 500,00')
  })

  it('no encola si ya pagó el total (saldo cero)', async () => {
    filas = [reserva({ pagos: [{ tipo: 'senia', monto: '500', estado: 'aprobado' }] })]
    const { POST } = await import('@/app/api/cron/recordatorios-pago/route')
    const res = await POST(pedido(`Bearer ${SECRETO}`))
    const body = (await res.json()) as { encoladas: number }
    expect(body.encoladas).toBe(0)
    expect(encolados).toHaveLength(0)
  })

  it('no encola si el huésped no tiene email', async () => {
    filas = [reserva({ huesped: { nombre: 'Ana', apellido: 'Gómez', email: null } })]
    const { POST } = await import('@/app/api/cron/recordatorios-pago/route')
    const res = await POST(pedido(`Bearer ${SECRETO}`))
    const body = (await res.json()) as { encoladas: number }
    expect(body.encoladas).toBe(0)
  })

  it('GET hace lo mismo que POST (así lo dispara Vercel Cron)', async () => {
    filas = [reserva()]
    const { GET } = await import('@/app/api/cron/recordatorios-pago/route')
    const res = await GET(pedido(`Bearer ${SECRETO}`))
    expect(res.status).toBe(200)
  })
})
