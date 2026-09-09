import 'server-only'

/**
 * Abstracción del proveedor de WhatsApp (`WhatsAppProvider`).
 *
 * Patrón de referencia: la mensajería de Evolution API, adaptada al mismo
 * criterio simulador/real que ya usan `PaymentProvider` y `EmailProvider`.
 *
 * Por Cloud API **oficial** de Meta, no por un puente sobre WhatsApp Web: el
 * número que Meta bloquearía ante un uso irregular es el del hotel, el mismo
 * publicado en su web y en Booking. Por HTTP y sin SDK, mismo criterio que
 * `lib/payments` y `lib/email/resend.ts`.
 */

import { seleccionarProveedor, advertirSiEsSimulado } from '@/lib/integraciones/seleccion'
import { ProveedorMetaWhatsApp } from './meta'

export interface MensajeWhatsApp {
  /** Formato E.164, ej. +5492966123456. */
  telefono: string
  /** Nombre de la plantilla aprobada en Meta Business Manager. */
  plantilla: string
  /** Valores posicionales, en el orden que la plantilla aprobada espera. */
  parametros: string[]
}

export interface ResultadoEnvioWhatsApp {
  ok: boolean
  detalle: string
  /** Id del mensaje del lado de Meta, para cruzar con el webhook de estado. */
  idExterno?: string
}

export interface WhatsAppProvider {
  nombre: string
  enviar(m: MensajeWhatsApp): Promise<ResultadoEnvioWhatsApp>
  /** Indica si los mensajes salen de verdad. La UI lo usa para avisar. */
  esReal(): boolean
}

/** Proveedor de consola: deja el rastro del envío sin mandar nada. */
class ProveedorSimuladoWhatsApp implements WhatsAppProvider {
  nombre = 'simulado'

  esReal(): boolean {
    return false
  }

  async enviar(m: MensajeWhatsApp): Promise<ResultadoEnvioWhatsApp> {
    // El teléfono va enmascarado por el mismo motivo que el email en
    // `lib/email/index.ts`: es un dato personal, y este log puede terminar en
    // una herramienta de observabilidad de terceros.
    const enmascarado = m.telefono.length > 4 ? `${'*'.repeat(m.telefono.length - 4)}${m.telefono.slice(-4)}` : m.telefono
    console.info(
      `[whatsapp:${this.nombre}] → ${enmascarado} · plantilla "${m.plantilla}" · ${m.parametros.length} parámetro(s)`,
    )
    return {
      ok: true,
      detalle: `Simulado: el WhatsApp para ${enmascarado} quedó registrado, no se envió.`,
    }
  }
}

const PROVEEDORES: Record<string, WhatsAppProvider> = {
  simulado: new ProveedorSimuladoWhatsApp(),
  meta: new ProveedorMetaWhatsApp(),
}

export function obtenerProveedorWhatsApp(
  nombre: string | undefined = process.env.WHATSAPP_PROVIDER,
): WhatsAppProvider {
  const proveedor = seleccionarProveedor({
    variable: 'WHATSAPP_PROVIDER',
    proveedores: PROVEEDORES,
    simulado: 'simulado',
    valor: nombre,
  })
  advertirSiEsSimulado(proveedor, 'WHATSAPP_PROVIDER')
  return proveedor
}

export async function enviarWhatsApp(m: MensajeWhatsApp): Promise<ResultadoEnvioWhatsApp> {
  return obtenerProveedorWhatsApp().enviar(m)
}
