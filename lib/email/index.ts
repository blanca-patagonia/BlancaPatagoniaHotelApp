import 'server-only'
import { renderizar, type EventoEmail } from '@/lib/domain/plantillas'

/**
 * Abstracción del proveedor de correo (`EmailProvider`).
 *
 * Quinto adapter del proyecto, con el mismo patrón que `PaymentProvider`,
 * `FirmaElectronicaProvider`, `AsistenteProvider` y
 * `FacturacionElectronicaProvider`.
 *
 * ⚠️ El proveedor vigente **no envía nada**: registra el correo en la consola
 * del servidor. Integrar Resend o SMTP es escribir una clase que implemente la
 * interfaz y cambiar `EMAIL_PROVIDER` (ver ADR 0012).
 */

import { seleccionarProveedor, advertirSiEsSimulado } from '@/lib/integraciones/seleccion'

export interface MensajeEmail {
  para: string
  asunto: string
  cuerpo: string
}

export interface ResultadoEnvio {
  ok: boolean
  /** Detalle para mostrar en pantalla (motivo del rechazo o confirmación). */
  detalle: string
}

export interface EmailProvider {
  nombre: string
  enviar(m: MensajeEmail): Promise<ResultadoEnvio>
  /** Indica si los correos salen de verdad. La UI lo usa para avisar. */
  esReal(): boolean
}

/** Proveedor de consola: deja el rastro del envío sin mandar nada. */
class ProveedorConsola implements EmailProvider {
  nombre = 'consola'

  esReal(): boolean {
    return false
  }

  async enviar(m: MensajeEmail): Promise<ResultadoEnvio> {
    if (!m.para || !m.para.includes('@')) {
      return { ok: false, detalle: 'El destinatario no tiene un email válido.' }
    }

    console.info(
      `[email:${this.nombre}] → ${m.para}\n  Asunto: ${m.asunto}\n  ${m.cuerpo.replace(/\n/g, '\n  ')}`,
    )
    return {
      ok: true,
      detalle: `Simulado: el correo para ${m.para} quedó registrado en el servidor, no se envió.`,
    }
  }
}

const PROVEEDORES: Record<string, EmailProvider> = {
  consola: new ProveedorConsola(),
}

export function obtenerProveedorEmail(
  nombre: string | undefined = process.env.EMAIL_PROVIDER,
): EmailProvider {
  // El proveedor «consola» no envía nada: escribe el correo en el log. Si queda
  // activo por descuido en producción, la confirmación de reserva, el enlace de
  // firma y la encuesta nunca llegan al huésped, y el sistema informa «enviado».
  const proveedor = seleccionarProveedor({
    variable: 'EMAIL_PROVIDER',
    proveedores: PROVEEDORES,
    simulado: 'consola',
    valor: nombre,
  })
  advertirSiEsSimulado(proveedor, 'EMAIL_PROVIDER')
  return proveedor
}

/**
 * Renderiza una plantilla y la envía.
 *
 * Es el único punto por el que salen las comunicaciones al huésped: así el
 * texto siempre viene del catálogo de plantillas y nunca se arma a mano.
 */
export async function enviarPlantilla(
  evento: EventoEmail,
  para: string | null,
  variables: Record<string, string | number>,
): Promise<ResultadoEnvio> {
  if (!para) return { ok: false, detalle: 'El destinatario no tiene email cargado.' }

  const { asunto, cuerpo, faltantes } = renderizar(evento, variables)
  if (faltantes.length > 0) {
    return {
      ok: false,
      detalle: `Faltan datos para completar la plantilla: ${faltantes.join(', ')}.`,
    }
  }

  return obtenerProveedorEmail().enviar({ para, asunto, cuerpo })
}
