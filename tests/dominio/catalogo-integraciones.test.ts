import { describe, it, expect } from 'vitest'
import { INTEGRACIONES, diagnosticar, todasLasVariables, urlPublicaValida, urlWebhook } from '@/lib/domain/integraciones'

const integracion = (id: string) => {
  const i = INTEGRACIONES.find((x) => x.id === id)
  if (!i) throw new Error(`no existe ${id}`)
  return i
}

describe('catálogo de integraciones', () => {
  it('ids únicos y cada una dice qué pasa si falta', () => {
    const ids = INTEGRACIONES.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const i of INTEGRACIONES) {
      expect(i.siFalta.length, i.id).toBeGreaterThan(0)
      expect(i.pasos.length, i.id).toBeGreaterThan(0)
    }
  })

  it('una variable compartida tiene el mismo nombre en todas (no hay dos grafías)', () => {
    const nombres = todasLasVariables()
    expect(nombres).toContain('META_WEBHOOK_VERIFY_TOKEN')
    expect(nombres.every((n) => /^[A-Z][A-Z0-9_]+$/.test(n))).toBe(true)
  })
})

describe('diagnosticar', () => {
  it('sin nada cargado: sin configurar', () => {
    expect(diagnosticar(integracion('stripe'), {}).estado).toBe('sin_configurar')
  })

  it('con todo pero sin el interruptor: apagada, y dice qué agregar', () => {
    const d = diagnosticar(integracion('stripe'), { STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: 'y', PAGO_PROVIDER: 'mercadopago' })
    expect(d.estado).toBe('apagada')
    expect(d.indicacion).toMatch(/stripe/)
  })

  it('el interruptor en lista acepta varias pasarelas separadas por comas', () => {
    const d = diagnosticar(integracion('stripe'), { STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: 'y', PAGO_PROVIDER: 'mercadopago, stripe' })
    expect(d.estado).toBe('lista')
  })

  it('interruptor encendido sin claves: incompleta, con lo que falta', () => {
    const d = diagnosticar(integracion('mercadopago'), { PAGO_PROVIDER: 'mercadopago' })
    expect(d.estado).toBe('incompleta')
    expect(d.faltantes).toEqual(['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'])
  })

  it('una variable COMPARTIDA no «empieza» a las demás: WhatsApp listo no deja a Instagram a medias', () => {
    const env = { WHATSAPP_TOKEN: 'a', WHATSAPP_PHONE_NUMBER_ID: 'b', META_APP_SECRET: 'c', META_WEBHOOK_VERIFY_TOKEN: 'd' }
    expect(diagnosticar(integracion('whatsapp'), env).estado).toBe('lista')
    expect(diagnosticar(integracion('instagram'), env).estado).toBe('sin_configurar')
    expect(diagnosticar(integracion('messenger'), env).estado).toBe('sin_configurar')
  })

  it('Instagram acepta su propio secreto en lugar del de Meta', () => {
    const base = { INSTAGRAM_ACCESS_TOKEN: 'a', META_WEBHOOK_VERIFY_TOKEN: 'b' }
    expect(diagnosticar(integracion('instagram'), base).faltantes).toEqual(['META_APP_SECRET o INSTAGRAM_APP_SECRET'])
    expect(diagnosticar(integracion('instagram'), { ...base, INSTAGRAM_APP_SECRET: 'c' }).estado).toBe('lista')
  })

  it('un valor con sólo espacios cuenta como no cargado', () => {
    expect(diagnosticar(integracion('telegram'), { TELEGRAM_BOT_TOKEN: '  ', TELEGRAM_WEBHOOK_SECRET: 'x' }).faltantes).toEqual(['TELEGRAM_BOT_TOKEN'])
  })
})

describe('urlWebhook', () => {
  it('une sin barras dobles y avisa si falta la dirección del sitio', () => {
    expect(urlWebhook('https://hotel.com/', '/api/webhooks/meta')).toBe('https://hotel.com/api/webhooks/meta')
    expect(urlWebhook(undefined, '/api/x')).toMatch(/NEXT_PUBLIC_SITE_URL/)
  })
})

describe('urlPublicaValida', () => {
  it('acepta una dirección https pública', () => {
    expect(urlPublicaValida('https://reservas.blancapatagonia.com')).toEqual({ valida: true, motivo: null })
  })

  it('rechaza localhost, redes locales y direcciones sin https, diciendo por qué', () => {
    for (const u of ['http://localhost:3000', 'https://localhost:3000', 'https://127.0.0.1', 'https://192.168.1.20', 'https://10.0.0.5', 'https://172.20.1.1', 'https://mac.local']) {
      expect(urlPublicaValida(u).valida, u).toBe(false)
    }
    expect(urlPublicaValida('http://hotel.com').motivo).toMatch(/https/)
    expect(urlPublicaValida(undefined).motivo).toMatch(/NEXT_PUBLIC_SITE_URL/)
    expect(urlPublicaValida('esto no es una url').valida).toBe(false)
  })

  it('172.15 y 172.32 NO son de la red local (el rango privado es 172.16–172.31)', () => {
    expect(urlPublicaValida('https://172.15.0.1').valida).toBe(true)
    expect(urlPublicaValida('https://172.32.0.1').valida).toBe(true)
  })
})
