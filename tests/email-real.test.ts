import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProveedorResend } from '@/lib/email/resend'

/**
 * Adapter real de email (Resend), con la red simulada.
 *
 * Qué se prueba: que el HTML del correo (Fase 5) viaja en la misma llamada que
 * el texto plano, y que sin `cuerpoHtml` no se manda un campo `html` vacío —
 * Resend acepta las dos partes en un solo `POST`, así que la trampa acá no es
 * de protocolo (como en `pasarelas-reales.test.ts`) sino de que alguien borre
 * el armado del cuerpo HTML sin que ningún tipo lo marque.
 */

const fetchOriginal = globalThis.fetch

beforeEach(() => {
  process.env.RESEND_API_KEY = 'ejemplo-clave-resend'
  process.env.EMAIL_FROM = 'reservas@blancapatagonia.com'
})

afterEach(() => {
  globalThis.fetch = fetchOriginal
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_FROM
})

/** Reemplaza `fetch` por uno que devuelve éxito y guarda lo que se le mandó. */
function fetchFalso() {
  const llamadas: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init })
    return {
      ok: true,
      text: async () => JSON.stringify({ id: 'email_123' }),
    } as Response
  }) as unknown as typeof fetch
  return llamadas
}

function cuerpoEnviado(llamadas: { init: RequestInit }[]) {
  return JSON.parse(String(llamadas[0].init.body))
}

describe('Resend · HTML junto al texto plano', () => {
  it('manda `html` cuando la plantilla trae cuerpoHtml', async () => {
    const llamadas = fetchFalso()
    await new ProveedorResend().enviar({
      para: 'ana@ejemplo.com',
      asunto: 'Recibimos tu reserva',
      cuerpo: 'Hola Ana,\n\nGracias.',
      cuerpoHtml: '<div><p>Hola Ana,</p><p>Gracias.</p></div>',
    })

    const cuerpo = cuerpoEnviado(llamadas)
    expect(cuerpo.text).toBe('Hola Ana,\n\nGracias.')
    expect(cuerpo.html).toBe('<div><p>Hola Ana,</p><p>Gracias.</p></div>')
  })

  it('sin cuerpoHtml no manda el campo, en vez de mandarlo vacío', async () => {
    const llamadas = fetchFalso()
    await new ProveedorResend().enviar({
      para: 'ana@ejemplo.com',
      asunto: 'Aviso',
      cuerpo: 'Solo texto.',
    })

    const cuerpo = cuerpoEnviado(llamadas)
    expect(cuerpo.text).toBe('Solo texto.')
    expect(cuerpo.html).toBeUndefined()
  })
})
