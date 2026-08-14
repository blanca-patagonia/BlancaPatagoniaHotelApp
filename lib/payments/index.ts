import 'server-only'
import type { MedioPago, TipoPago, EstadoPago } from '@/lib/domain/pagos'

/**
 * Abstracción de pasarelas de pago (`PaymentProvider`).
 *
 * El sistema opera hoy con pagos MANUALES (efectivo/transferencia, ver
 * `registrarPago`). Esta capa deja preparada la integración con MercadoPago y
 * Stripe: cada proveedor sabe (1) crear un checkout y (2) interpretar y validar
 * su webhook. Las implementaciones actuales son **stubs** con la forma correcta;
 * al tener las credenciales reales se completa `crearCheckout` / `verificarFirma`
 * sin tocar el resto del sistema.
 */

import { verificarFirmaWebhook } from '@/lib/integraciones/firma-webhook'

export interface CheckoutParams {
  reservaId: string
  monto: number
  moneda: string
  descripcion: string
  tipo: Extract<TipoPago, 'senia' | 'saldo'>
}

export interface CheckoutResult {
  url: string
  externalId: string
}

/** Evento normalizado que produce un webhook, sea cual sea la pasarela. */
export interface WebhookEvent {
  externalId: string
  reservaId: string
  monto: number
  medio: MedioPago
  tipo: TipoPago
  estado: EstadoPago
}

export interface PaymentProvider {
  nombre: MedioPago
  crearCheckout(p: CheckoutParams): Promise<CheckoutResult>
  verificarFirma(req: Request): Promise<boolean>
  parsearWebhook(req: Request): Promise<WebhookEvent | null>
}

/**
 * Proveedor genérico (stub). Modela el contrato sin llamar a un SDK real:
 * - `crearCheckout` devuelve una URL de pago simulada.
 * - `verificarFirma` valida un secreto por header si está configurado; en
 *   desarrollo (sin secreto) acepta, dejando el enganche listo.
 * - `parsearWebhook` normaliza un cuerpo JSON `{ external_id, reserva_id, monto,
 *   tipo, estado }`.
 */
class ProveedorStub implements PaymentProvider {
  constructor(public nombre: MedioPago) {}

  async crearCheckout(p: CheckoutParams): Promise<CheckoutResult> {
    const externalId = `${this.nombre}-${p.reservaId}-${p.tipo}`
    const url = `/pago-simulado?proveedor=${this.nombre}&external_id=${encodeURIComponent(externalId)}`
    return { url, externalId }
  }

  async verificarFirma(req: Request): Promise<boolean> {
    const secreto = process.env[`${this.nombre.toUpperCase()}_WEBHOOK_SECRET`]
    if (!secreto) {
      // Sin secreto configurado: se acepta SOLO fuera de producción (enganche de
      // desarrollo). En producción se rechaza (fail-closed) para que nadie pueda
      // registrar pagos falsos sin la firma de la pasarela.
      return process.env.NODE_ENV !== 'production'
    }

    // El cuerpo tiene que leerse CRUDO: parsearlo y volver a serializarlo cambia
    // espacios y orden de claves, y la firma deja de coincidir. Por eso el
    // llamador pasa un `req.clone()`.
    const cuerpo = await req.text()
    const { valida, motivo } = await verificarFirmaWebhook(secreto, req.headers, cuerpo)

    if (!valida) {
      // El motivo va al log del servidor y nunca a la respuesta: decirle a quien
      // llama *por qué* falló su firma es ayudarlo a construir una válida.
      console.error(`[webhook ${this.nombre}] firma rechazada: ${motivo}`)
    }
    return valida
  }

  async parsearWebhook(req: Request): Promise<WebhookEvent | null> {
    let cuerpo: Record<string, unknown>
    try {
      cuerpo = await req.json()
    } catch {
      return null
    }
    const externalId = String(cuerpo.external_id ?? '')
    const reservaId = String(cuerpo.reserva_id ?? '')
    const monto = Number(cuerpo.monto ?? 0)
    if (!externalId || !reservaId || !(monto > 0)) return null
    const tipo = (cuerpo.tipo as TipoPago) ?? 'saldo'
    const estado = (cuerpo.estado as EstadoPago) ?? 'aprobado'
    return { externalId, reservaId, monto, medio: this.nombre, tipo, estado }
  }
}

const PROVEEDORES: Record<string, PaymentProvider> = {
  mercadopago: new ProveedorStub('mercadopago'),
  stripe: new ProveedorStub('stripe'),
}

export function obtenerProveedor(nombre: string): PaymentProvider | null {
  return PROVEEDORES[nombre] ?? null
}
