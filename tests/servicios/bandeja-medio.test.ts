import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Proxy de archivos de WhatsApp (`/api/bandeja/medio/{id}`).
 *
 * Es una puerta: baja con el token del hotel un archivo que mandó un
 * desconocido y se lo reenvía al navegador del staff. Lo que se prueba es lo que
 * impide que sea un agujero: quién puede pedirlo, qué `id` se acepta (un id con
 * barras armaría una URL a otro recurso con el token del hotel) y cómo se sirve
 * lo que no es una imagen.
 */

let sesion: { rol: string } | null = null

vi.mock('@/lib/auth/session', () => ({ obtenerSesion: async () => sesion }))
vi.mock('@/lib/registro', () => ({ registrarError: async () => undefined }))

const llamadas: string[] = []
let meta: { status: number; json: unknown } = { status: 200, json: {} }
let archivo: { status: number; tipo?: string } = { status: 200 }

async function pedir(id: string) {
  const { GET } = await import('@/app/(back-api)/api/bandeja/medio/[id]/route')
  return GET(new Request('http://x/api/bandeja/medio/' + id), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  llamadas.length = 0
  sesion = { rol: 'recepcion' }
  meta = { status: 200, json: { url: 'https://lookaside.fbsbx.com/f/abc', mime_type: 'image/jpeg', file_size: 1000 } }
  archivo = { status: 200 }
  vi.stubEnv('WHATSAPP_TOKEN', 'tok-secreto')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      llamadas.push(`${String(url)} | ${JSON.stringify(init.headers ?? {})}`)
      if (String(url).startsWith('https://graph.facebook.com')) return new Response(JSON.stringify(meta.json), { status: meta.status })
      return new Response('BYTES', { status: archivo.status })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('/api/bandeja/medio/[id]', () => {
  it('sin sesión: 401, y no llama a Meta', async () => {
    sesion = null
    expect((await pedir('12345678')).status).toBe(401)
    expect(llamadas).toHaveLength(0)
  })

  it('housekeeping no ve la bandeja: 403', async () => {
    sesion = { rol: 'housekeeping' }
    expect((await pedir('12345678')).status).toBe(403)
    expect(llamadas).toHaveLength(0)
  })

  it.each(['../me', '123/../../x', '12345678?fields=x', 'abc12345', '1234', '12345678901234567890123456789012345'])(
    'rechaza el id «%s» antes de hablar con Meta (SSRF)',
    async (id) => {
      expect((await pedir(id)).status).toBe(400)
      expect(llamadas).toHaveLength(0)
    },
  )

  it('baja el archivo con el token del hotel y lo sirve inline con cabeceras de aislamiento', async () => {
    const r = await pedir('12345678')
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('BYTES')
    expect(r.headers.get('content-type')).toBe('image/jpeg')
    expect(r.headers.get('content-disposition')).toBe('inline')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('content-security-policy')).toMatch(/sandbox/)
    expect(r.headers.get('cache-control')).toMatch(/private/)
    // Las dos llamadas llevan el token; la respuesta al navegador NO.
    expect(llamadas.every((l) => l.includes('tok-secreto'))).toBe(true)
    expect([...r.headers.values()].join(' ')).not.toContain('tok-secreto')
  })

  it('un HTML que mandó un desconocido NO se sirve como HTML: se baja como binario', async () => {
    meta.json = { url: 'https://lookaside.fbsbx.com/f/x', mime_type: 'text/html', file_size: 10 }
    const r = await pedir('12345678')
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
    expect(r.headers.get('content-disposition')).toBe('attachment')
  })

  it('un SVG (puede llevar scripts) tampoco se muestra', async () => {
    meta.json = { url: 'https://lookaside.fbsbx.com/f/x', mime_type: 'image/svg+xml', file_size: 10 }
    expect((await pedir('12345678')).headers.get('content-disposition')).toBe('attachment')
  })

  it('un archivo gigante se rechaza sin bajarlo', async () => {
    meta.json = { url: 'https://lookaside.fbsbx.com/f/x', mime_type: 'video/mp4', file_size: 50 * 1024 * 1024 }
    expect((await pedir('12345678')).status).toBe(413)
    expect(llamadas).toHaveLength(1)
  })

  it('una URL que no es https en la respuesta de Meta no se sigue', async () => {
    meta.json = { url: 'http://interno.local/secreto', mime_type: 'image/png', file_size: 1 }
    expect((await pedir('12345678')).status).toBe(502)
    expect(llamadas).toHaveLength(1)
  })

  it('un archivo que Meta ya borró es 404; sin token configurado, 503', async () => {
    meta = { status: 404, json: {} }
    expect((await pedir('12345678')).status).toBe(404)
    vi.stubEnv('WHATSAPP_TOKEN', '')
    expect((await pedir('12345678')).status).toBe(503)
  })
})
