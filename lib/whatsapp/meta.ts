import 'server-only'
import type { WhatsAppProvider, MensajeWhatsApp, ResultadoEnvioWhatsApp } from '.'

/**
 * Envío real por la Cloud API de WhatsApp Business (Meta).
 *
 * Por qué HTTP y no el SDK de Meta: es una llamada `POST` con un token en la
 * cabecera, mismo criterio que los adapters de MercadoPago, Stripe y Resend
 * (ADR 0027). El SDK oficial agrega una dependencia para envolver eso.
 *
 * ── Lo que este adapter NO hace ─────────────────────────────────────────────
 *
 * No arma la plantilla ni decide sus parámetros — eso es
 * `armarMensajeWhatsApp` (`lib/domain/plantillas.ts`), que es puro y está
 * probado. Este archivo solo serializa y llama a Meta.
 *
 * No reintenta: de eso se ocupa la bandeja de salida (`lib/notificaciones`,
 * migración 0075), igual que con el email.
 */

const VERSION_API = 'v21.0'
const IDIOMA = 'es_AR'

/** Corte de la llamada. Sin esto, un proveedor colgado bloquea la corrida entera. */
const TIMEOUT_MS = 10_000

export class ProveedorMetaWhatsApp implements WhatsAppProvider {
  nombre = 'meta'

  esReal(): boolean {
    return true
  }

  async enviar(m: MensajeWhatsApp): Promise<ResultadoEnvioWhatsApp> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
    const idNumero = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
    if (!token || !idNumero) {
      return { ok: false, detalle: 'Falta WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.' }
    }

    const controlador = new AbortController()
    const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS)

    try {
      const resp = await fetch(`https://graph.facebook.com/${VERSION_API}/${idNumero}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          // Meta exige el número sin el '+' ni separadores.
          to: m.telefono.replace(/[^\d]/g, ''),
          type: 'template',
          template: {
            name: m.plantilla,
            language: { code: IDIOMA },
            ...(m.parametros.length > 0
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: m.parametros.map((valor) => ({ type: 'text', text: valor })),
                    },
                  ],
                }
              : {}),
          },
        }),
        signal: controlador.signal,
      })

      const cuerpo = (await resp.json().catch(() => null)) as {
        messages?: { id: string }[]
        error?: { message: string }
      } | null

      if (!resp.ok) {
        return {
          ok: false,
          detalle: cuerpo?.error?.message ?? `WhatsApp rechazó el envío (HTTP ${resp.status}).`,
        }
      }

      return { ok: true, detalle: 'Enviado.', idExterno: cuerpo?.messages?.[0]?.id }
    } catch (e) {
      const detalle = e instanceof Error ? e.message : 'Error de red al llamar a WhatsApp.'
      return { ok: false, detalle: e instanceof Error && e.name === 'AbortError' ? 'WhatsApp no respondió a tiempo.' : detalle }
    } finally {
      clearTimeout(corte)
    }
  }
}
