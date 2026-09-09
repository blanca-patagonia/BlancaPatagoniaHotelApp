import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { obtenerProveedorWhatsApp } from '@/lib/whatsapp'
import { ProveedorMetaWhatsApp } from '@/lib/whatsapp/meta'

/**
 * Adapter de WhatsApp (Fase 3, patrón de referencia: Evolution API).
 *
 * `seleccionarProveedor` en sí ya está probado en `tests/integraciones.test.ts`;
 * acá se prueba lo específico de este adapter: qué hace el simulador y cómo
 * arma el adapter real la llamada a Meta.
 */

describe('proveedor simulado de WhatsApp', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('nunca llama a la red y siempre responde ok', async () => {
    const proveedor = obtenerProveedorWhatsApp('simulado')
    expect(proveedor.esReal()).toBe(false)
    const r = await proveedor.enviar({ telefono: '+5492966123456', plantilla: 'confirmacion_reserva', parametros: ['Ana'] })
    expect(r.ok).toBe(true)
  })

  it('fuera de producción, sin configurar nada, cae en el simulado', () => {
    expect(obtenerProveedorWhatsApp(undefined).esReal()).toBe(false)
  })
})

describe('ProveedorMetaWhatsApp', () => {
  const fetchOriginal = global.fetch

  beforeEach(() => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'un-token-cualquiera')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123456')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    global.fetch = fetchOriginal
  })

  it('sin credenciales, no llama a la red y avisa qué falta', async () => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')
    let llamado = false
    global.fetch = (async () => {
      llamado = true
      return new Response('{}')
    }) as typeof fetch

    const proveedor = new ProveedorMetaWhatsApp()
    const r = await proveedor.enviar({ telefono: '+549123', plantilla: 'x', parametros: [] })
    expect(r.ok).toBe(false)
    expect(r.detalle).toMatch(/WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID/)
    expect(llamado).toBe(false)
  })

  it('arma la plantilla con los parámetros EN ORDEN, y el teléfono sin signos', async () => {
    let cuerpoEnviado: Record<string, unknown> | null = null
    global.fetch = (async (_url: unknown, init?: RequestInit) => {
      cuerpoEnviado = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), { status: 200 })
    }) as typeof fetch

    const proveedor = new ProveedorMetaWhatsApp()
    const r = await proveedor.enviar({
      telefono: '+54 9 296 612-3456',
      plantilla: 'confirmacion_reserva',
      parametros: ['Ana', 'BP-100', '10 de enero'],
    })

    expect(r.ok).toBe(true)
    expect(r.idExterno).toBe('wamid.123')
    const cuerpo = cuerpoEnviado as unknown as {
      to: string
      template: { name: string; components: { parameters: { text: string }[] }[] }
    }
    expect(cuerpo.to).toBe('5492966123456')
    expect(cuerpo.template.name).toBe('confirmacion_reserva')
    expect(cuerpo.template.components[0].parameters.map((p) => p.text)).toEqual([
      'Ana',
      'BP-100',
      '10 de enero',
    ])
  })

  it('si Meta rechaza el envío, devuelve el motivo que informó Meta', async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'plantilla no aprobada' } }), { status: 400 })) as typeof fetch

    const proveedor = new ProveedorMetaWhatsApp()
    const r = await proveedor.enviar({ telefono: '+549123', plantilla: 'x', parametros: [] })
    expect(r.ok).toBe(false)
    expect(r.detalle).toBe('plantilla no aprobada')
  })
})
