import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { hmacHex } from '@/lib/integraciones/firma-webhook'

/**
 * Webhook de WhatsApp (Meta Cloud API).
 *
 * Igual que el de pagos: lo que hay que probar es que rechace sin la firma
 * correcta, y que el estado de entrega avance en el orden correcto cuando la
 * firma es válida. La base se simula porque no hay Docker en CI sin él; el
 * cálculo de si algo es un avance real (`esAvanceDeEntrega`) es real y puro.
 */

const SECRETO = 'secreto-de-prueba'
const VERIFICACION_ESPERADA = 'verificacion-de-prueba'

let filas: Record<string, { id: string; estado: string }>
let actualizados: { id: string; estado: string }[]

vi.mock('@/lib/supabase/admin', () => ({
  crearClienteAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: async () => ({ data: filas[val] ?? null, error: null }),
        }),
      }),
      update: (cambios: { estado: string }) => ({
        eq: async (_col: string, id: string) => {
          actualizados.push({ id, estado: cambios.estado })
          return { error: null }
        },
      }),
    }),
  }),
}))
vi.mock('@/lib/limites', () => ({ permitirIntento: async () => true }))
vi.mock('@/lib/registro', () => ({ registrarError: async () => {}, registrarInfo: async () => {} }))

async function pedidoFirmado(payload: unknown): Promise<Request> {
  const cuerpo = JSON.stringify(payload)
  const firma = `sha256=${await hmacHex(SECRETO, cuerpo)}`
  return new Request('https://h.local/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': firma },
    body: cuerpo,
  })
}

function evento(id: string, status: 'sent' | 'delivered' | 'read' | 'failed') {
  return { entry: [{ changes: [{ value: { statuses: [{ id, status }] } }] }] }
}

describe('webhook de WhatsApp · handshake (GET)', () => {
  beforeEach(() => vi.stubEnv('WHATSAPP_VERIFY_TOKEN', VERIFICACION_ESPERADA))
  afterEach(() => vi.unstubAllEnvs())

  it('sin WHATSAPP_VERIFY_TOKEN configurado, 503', async () => {
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', '')
    const { GET } = await import('@/app/api/webhooks/whatsapp/route')
    const res = await GET(new Request('https://h.local/api/webhooks/whatsapp'))
    expect(res.status).toBe(503)
  })

  it('la verificación correcta devuelve el challenge tal cual', async () => {
    const { GET } = await import('@/app/api/webhooks/whatsapp/route')
    const url = `https://h.local/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFICACION_ESPERADA}&hub.challenge=abc123`
    const res = await GET(new Request(url))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('abc123')
  })

  it('la verificación incorrecta rechaza con 403, no devuelve el challenge', async () => {
    const { GET } = await import('@/app/api/webhooks/whatsapp/route')
    const url = `https://h.local/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otra-cosa&hub.challenge=abc123`
    const res = await GET(new Request(url))
    expect(res.status).toBe(403)
  })
})

describe('webhook de WhatsApp · eventos (POST)', () => {
  beforeEach(() => {
    filas = {}
    actualizados = []
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('sin WHATSAPP_APP_SECRET configurado, 503', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', '')
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    const res = await POST(await pedidoFirmado(evento('m1', 'delivered')))
    expect(res.status).toBe(503)
  })

  it('rechaza con firma inválida', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    const req = new Request('https://h.local/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=no-coincide' },
      body: JSON.stringify(evento('m1', 'delivered')),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(actualizados).toHaveLength(0)
  })

  it('con firma válida, marca entregada una notificación enviada', async () => {
    filas['m1'] = { id: 'n1', estado: 'enviada' }
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    const res = await POST(await pedidoFirmado(evento('m1', 'delivered')))
    expect(res.status).toBe(200)
    expect(actualizados).toEqual([{ id: 'n1', estado: 'entregada' }])
  })

  it('un evento tardío no hace retroceder de leída a entregada', async () => {
    filas['m1'] = { id: 'n1', estado: 'leida' }
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    await POST(await pedidoFirmado(evento('m1', 'delivered')))
    expect(actualizados).toHaveLength(0)
  })

  it('"sent" no actualiza nada: no aporta sobre "enviada"', async () => {
    filas['m1'] = { id: 'n1', estado: 'enviada' }
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    await POST(await pedidoFirmado(evento('m1', 'sent')))
    expect(actualizados).toHaveLength(0)
  })

  it('un id externo que no existe en la base no rompe nada, responde 200', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    const res = await POST(await pedidoFirmado(evento('desconocido', 'delivered')))
    expect(res.status).toBe(200)
    expect(actualizados).toHaveLength(0)
  })

  it('cuerpo que no es JSON: 200, no 400 (no interesa deshabilitar el webhook)', async () => {
    const cuerpo = 'esto no es json'
    const firma = `sha256=${await hmacHex(SECRETO, cuerpo)}`
    const req = new Request('https://h.local/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'x-hub-signature-256': firma },
      body: cuerpo,
    })
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
