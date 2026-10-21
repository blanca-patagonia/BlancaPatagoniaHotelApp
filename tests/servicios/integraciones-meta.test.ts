import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  conectarInstagram,
  conectarMessenger,
  conectarWhatsApp,
  crearWebhookDeCorreo,
  verificarConexion,
} from '@/lib/integraciones/meta'

/**
 * Conexión automática de canales (ADR 0044) contra un `fetch` simulado.
 *
 * Lo que se verifica es QUÉ se le manda a cada proveedor —la URL, el método, las
 * cabeceras y el cuerpo—, porque es lo que no se puede probar contra Meta real
 * desde acá. Un campo con otro nombre no falla ruidosamente: Meta responde 200
 * y no avisa nunca.
 */

interface Llamada {
  url: string
  metodo: string
  cabeceras: Record<string, string>
  cuerpo: string
}

let llamadas: Llamada[] = []
let respuestas: { cuando: RegExp; status?: number; json: unknown }[] = []

function simular() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const u = String(url)
      llamadas.push({
        url: u,
        metodo: init.method ?? 'GET',
        cabeceras: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
        cuerpo: init.body ? String(init.body) : '',
      })
      const r = respuestas.find((x) => x.cuando.test(`${init.method ?? 'GET'} ${u}`))
      const status = r?.status ?? 200
      return new Response(JSON.stringify(r?.json ?? { success: true }), { status })
    }),
  )
}

const URL_META = 'https://hotel.example.com/api/webhooks/meta'

/** El entorno sin una variable. */
function sin<T extends Record<string, string>>(env: T, clave: keyof T): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k !== clave))
}

const ENV = {
  WHATSAPP_TOKEN: 'tok-wa',
  WHATSAPP_PHONE_NUMBER_ID: '111',
  WHATSAPP_BUSINESS_ACCOUNT_ID: '222',
  META_WEBHOOK_VERIFY_TOKEN: 'verif',
  META_APP_ID: '999',
  META_APP_SECRET: 'sec',
  INSTAGRAM_ACCESS_TOKEN: 'tok-ig',
  INSTAGRAM_ACCOUNT_ID: '333',
  MESSENGER_PAGE_TOKEN: 'tok-fb',
  MESSENGER_PAGE_ID: '444',
}

beforeEach(() => {
  llamadas = []
  respuestas = []
  simular()
})
afterEach(() => vi.unstubAllGlobals())

describe('conectarWhatsApp', () => {
  it('suscribe la app a la cuenta y fija la URL del webhook del número', async () => {
    const r = await conectarWhatsApp(ENV, URL_META)
    expect(r.ok).toBe(true)

    const suscripcion = llamadas.find((l) => l.url.includes('/222/subscribed_apps'))
    expect(suscripcion?.metodo).toBe('POST')
    expect(suscripcion?.cabeceras.Authorization).toBe('Bearer tok-wa')
    expect(JSON.parse(suscripcion!.cuerpo)).toEqual({ subscribed_fields: ['messages', 'smb_message_echoes'] })

    const numero = llamadas.find((l) => l.url.endsWith('/111'))
    expect(numero?.metodo).toBe('POST')
    expect(JSON.parse(numero!.cuerpo)).toEqual({ webhook_configuration: { override_callback_uri: URL_META, verify_token: 'verif' } })
  })

  it('sin el ID de la cuenta no inventa nada: ese paso queda «no se pudo» y el total NO es éxito', async () => {
    const r = await conectarWhatsApp(sin(ENV, 'WHATSAPP_BUSINESS_ACCOUNT_ID'), URL_META)
    expect(r.ok).toBe(false)
    expect(r.pasos[0]).toMatchObject({ ok: null })
    expect(r.pasos[0].detalle).toMatch(/WHATSAPP_BUSINESS_ACCOUNT_ID/)
    expect(llamadas.some((l) => l.url.includes('subscribed_apps'))).toBe(false)
  })

  it('un token vencido (190) se explica en castellano', async () => {
    respuestas = [{ cuando: /POST .*subscribed_apps/, status: 400, json: { error: { code: 190, message: 'Invalid OAuth' } } }]
    const r = await conectarWhatsApp(ENV, URL_META)
    expect(r.ok).toBe(false)
    expect(r.pasos[0].detalle).toMatch(/venció|revocado/)
  })

  it('si Meta no puede verificar la URL, lo dice (suele ser una dirección que no es pública)', async () => {
    respuestas = [{ cuando: /POST .*\/111/, status: 400, json: { error: { message: 'The callback URL or verify token could not be validated' } } }]
    const r = await conectarWhatsApp(ENV, URL_META)
    expect(r.pasos[1].ok).toBe(false)
    expect(r.pasos[1].detalle).toMatch(/pública/)
  })
})

describe('conectarInstagram y conectarMessenger', () => {
  it('Instagram: registra el webhook de la app con el token de app y suscribe la cuenta', async () => {
    const r = await conectarInstagram(ENV, URL_META)
    expect(r.ok).toBe(true)

    const app = llamadas.find((l) => l.url.includes('/999/subscriptions'))
    const cuerpo = new URLSearchParams(app!.cuerpo)
    expect(app?.metodo).toBe('POST')
    expect(cuerpo.get('object')).toBe('instagram')
    expect(cuerpo.get('callback_url')).toBe(URL_META)
    expect(cuerpo.get('verify_token')).toBe('verif')
    expect(cuerpo.get('fields')).toContain('messages')
    expect(cuerpo.get('access_token')).toBe('999|sec')

    const cuenta = llamadas.find((l) => l.url.includes('graph.instagram.com') && l.url.includes('/333/subscribed_apps'))
    expect(cuenta?.metodo).toBe('POST')
    expect(new URL(cuenta!.url).searchParams.get('subscribed_fields')).toContain('messages')
  })

  it('Instagram sin META_APP_ID: el paso de la app queda pendiente pero la cuenta se suscribe igual', async () => {
    const r = await conectarInstagram(sin(ENV, 'META_APP_ID'), URL_META)
    expect(r.pasos[0]).toMatchObject({ ok: null })
    expect(r.pasos[0].detalle).toMatch(/a mano/)
    expect(r.pasos[1].ok).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('Instagram: si un paso FALLA, el total falla aunque otro haya salido', async () => {
    respuestas = [{ cuando: /POST .*\/999\/subscriptions/, status: 400, json: { error: { message: 'bad' } } }]
    expect((await conectarInstagram(ENV, URL_META)).ok).toBe(false)
  })

  it('Messenger: webhook de la app para «page» y suscripción de la página con su token', async () => {
    const r = await conectarMessenger(ENV, URL_META)
    expect(r.ok).toBe(true)
    const app = llamadas.find((l) => l.url.includes('/999/subscriptions'))
    expect(new URLSearchParams(app!.cuerpo).get('object')).toBe('page')
    const pagina = llamadas.find((l) => l.url.includes('/444/subscribed_apps'))
    expect(pagina?.cabeceras.Authorization).toBe('Bearer tok-fb')
    expect(new URLSearchParams(pagina!.cuerpo).get('subscribed_fields')).toBe('messages,message_deliveries,message_reads')
  })
})

describe('crearWebhookDeCorreo', () => {
  it('crea el webhook con los eventos de entrega Y el de correo recibido, y devuelve el secreto', async () => {
    respuestas = [{ cuando: /POST https:\/\/api\.resend\.com\/webhooks/, json: { id: 'w1', signing_secret: 'whsec_abc' } }]
    const r = await crearWebhookDeCorreo({ RESEND_API_KEY: 're_x' }, 'https://hotel.example.com/api/webhooks/email/resend')
    expect(r).toEqual({ ok: true, detalle: 'Webhook creado en Resend.', secreto: 'whsec_abc' })
    const l = llamadas[0]
    expect(l.cabeceras.Authorization).toBe('Bearer re_x')
    const cuerpo = JSON.parse(l.cuerpo)
    expect(cuerpo.endpoint).toBe('https://hotel.example.com/api/webhooks/email/resend')
    expect(cuerpo.events).toEqual(expect.arrayContaining(['email.received', 'email.bounced', 'email.delivered']))
  })

  it('sin clave no llama; con error de Resend no devuelve secreto', async () => {
    expect((await crearWebhookDeCorreo({}, 'https://x')).ok).toBe(false)
    expect(llamadas).toHaveLength(0)
    respuestas = [{ cuando: /webhooks/, status: 403, json: { message: 'restricted_api_key' } }]
    const r = await crearWebhookDeCorreo({ RESEND_API_KEY: 're_x' }, 'https://x')
    expect(r.ok).toBe(false)
    expect(r.secreto).toBeUndefined()
    expect(r.detalle).toMatch(/restricted_api_key/)
  })
})

describe('verificarConexion', () => {
  it('WhatsApp: ✓ cuando Meta tiene la URL de este sistema y la cuenta está suscripta', async () => {
    respuestas = [
      { cuando: /GET .*\/111\?/, json: { display_phone_number: '+54 9 2902 12-3456', verified_name: 'Hotel', webhook_configuration: { override_callback_uri: URL_META } } },
      { cuando: /GET .*\/222\/subscribed_apps/, json: { data: [{ whatsapp_business_api_data: {} }] } },
    ]
    const pasos = await verificarConexion('whatsapp', ENV, URL_META)
    expect(pasos.map((p) => p.ok)).toEqual([true, true, true])
  })

  it('WhatsApp: ✗ si Meta apunta a OTRA dirección (p. ej. quedó la del túnel de ayer)', async () => {
    respuestas = [
      { cuando: /GET .*\/111\?/, json: { display_phone_number: '1', webhook_configuration: { override_callback_uri: 'https://viejo.ngrok.app/x' } } },
      { cuando: /GET .*\/222\/subscribed_apps/, json: { data: [] } },
    ]
    const pasos = await verificarConexion('whatsapp', ENV, URL_META)
    expect(pasos[1]).toMatchObject({ ok: false })
    expect(pasos[2]).toMatchObject({ ok: false })
  })

  it('Telegram: compara la URL registrada y muestra el último error que tuvo al avisar', async () => {
    respuestas = [
      { cuando: /getMe/, json: { ok: true, result: { username: 'hotel_bot' } } },
      { cuando: /getWebhookInfo/, json: { ok: true, result: { url: 'https://otro.com/x', last_error_message: 'Wrong response from the webhook: 500' } } },
    ]
    const pasos = await verificarConexion('telegram', { TELEGRAM_BOT_TOKEN: 't' }, 'https://hotel.example.com/api/webhooks/telegram')
    expect(pasos[0].ok).toBe(true)
    expect(pasos[1]).toMatchObject({ ok: false })
    expect(pasos[2].detalle).toMatch(/500/)
  })

  it('un corte de red es un resultado, no una excepción', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    const pasos = await verificarConexion('whatsapp', ENV, URL_META)
    expect(pasos[0].ok).toBe(false)
    expect(pasos[0].detalle).toMatch(/ECONNRESET/)
  })

  it('nunca incluye una clave en lo que devuelve', async () => {
    respuestas = [{ cuando: /GET/, json: { display_phone_number: '1', webhook_configuration: {} } }]
    const texto = JSON.stringify(await verificarConexion('whatsapp', ENV, URL_META))
    for (const secreto of ['tok-wa', 'sec', 'verif', 'tok-ig', 'tok-fb']) expect(texto).not.toContain(`"${secreto}"`)
  })
})
