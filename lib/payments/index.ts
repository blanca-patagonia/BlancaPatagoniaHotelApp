import 'server-only'
import {
  ESTADOS_PAGO,
  TIPOS_PAGO,
  type MedioPago,
  type TipoPago,
  type EstadoPago,
} from '@/lib/domain/pagos'

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

/* ────────────────────────────── verificación de tarjeta de garantía ──── */

/**
 * Qué sabe hacer realmente este proveedor.
 *
 * Mismo patrón que `capacidades()` de `CanalVentaProvider` (ADR 0021), y por la
 * misma razón: **ningún proveedor cumple todo el contrato**. Declararlo permite
 * que la pantalla no ofrezca lo que no se puede hacer y, sobre todo, que advierta
 * la consecuencia en vez de simular que salió bien.
 */
export interface CapacidadesPago {
  /**
   * ¿Puede preautorizar una tarjeta contra el emisor y devolver un token?
   *
   * ⚠️ En `false`, el hotel **no tiene forma de saber si una tarjeta de garantía
   * sirve** hasta que intenta cobrarla. La pantalla tiene que decirlo: es la
   * diferencia entre una garantía real y un dato anotado.
   */
  verificaTarjeta: boolean
}

/** Datos de la tarjeta que viajan a la pasarela y **nunca** se guardan acá. */
export interface DatosTarjeta {
  /**
   * Número de tarjeta. Se usa para llamar a la pasarela y se descarta.
   *
   * ⚠️ NUNCA persistir este valor. La migración 0059 tiene restricciones que
   * rechazan un PAN en las columnas de garantía, y hay un test-contrato que
   * falla si alguna columna nueva pudiera contener uno (ADR 0025).
   */
  numero: string
  vencimiento: string
  titular: string
  cvv: string
}

/**
 * Lo que queda registrado de una verificación. **Nada de esto es un PAN.**
 */
export interface ResultadoVerificacionTarjeta {
  /** `false` cuando la tarjeta no sirve o cuando no se pudo verificar. */
  ok: boolean
  /**
   * `true` cuando el proveedor **no puede** verificar, en vez de haberlo
   * intentado y fallado.
   *
   * Distinguirlo es el punto entero: un `ok: false` por rechazo del emisor
   * significa «esta tarjeta no sirve, pedí otra»; un `ok: false` por falta de
   * pasarela significa «no sabemos nada de esta tarjeta». Confundirlos haría
   * que recepción le pida otra tarjeta a un huésped cuya tarjeta está perfecta.
   */
  noSoportado?: boolean
  /** Token opaco de la pasarela. Es lo único con lo que se puede cobrar después. */
  token?: string
  ultimos4?: string
  marca?: string
  /** `MM/AA`. */
  vencimiento?: string
  /** Motivo legible. Nunca incluye el número ni el CVV. */
  detalle?: string
}

export interface PaymentProvider {
  nombre: MedioPago
  /** Qué sabe hacer este proveedor. La pantalla lo usa para no prometer de más. */
  capacidades(): CapacidadesPago
  crearCheckout(p: CheckoutParams): Promise<CheckoutResult>
  verificarFirma(req: Request): Promise<boolean>
  parsearWebhook(req: Request): Promise<WebhookEvent | null>
  /**
   * Preautoriza la tarjeta contra el emisor y devuelve un token.
   *
   * Un proveedor que no puede hacerlo devuelve `{ ok: false, noSoportado: true }`.
   * **No lanza y no miente diciendo `ok: true`.**
   */
  verificarTarjeta(datos: DatosTarjeta): Promise<ResultadoVerificacionTarjeta>
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

  /**
   * El stub **no puede verificar una tarjeta**, y lo declara.
   *
   * Es la decisión más importante de esta clase. Verificar exige hablar con el
   * emisor a través de una pasarela contratada; sin ella no hay forma de saber
   * si una tarjeta sirve. Un simulador que devolviera «válida» sería peor que no
   * tener la función: recepción dejaría pasar un check-in confiando en una
   * garantía que nadie comprobó, y el hotel se enteraría el día que intente
   * cobrar un no-show.
   *
   * Es el mismo criterio que el ADR 0021 aplicó al overbooking de Booking:
   * declarar la limitación en vez de aparentar que no existe.
   */
  capacidades(): CapacidadesPago {
    return { verificaTarjeta: false }
  }

  /**
   * No verifica: lo dice.
   *
   * Devuelve `noSoportado: true` y **no** `ok: false` a secas, para que la
   * pantalla pueda distinguir «el emisor la rechazó» de «no hay con qué
   * probarla». Son dos situaciones distintas y llevan a acciones distintas.
   *
   * Los datos de la tarjeta se reciben y **se descartan**: no se guardan, no se
   * loguean y no se devuelven. Lo único que sale de acá son los últimos cuatro
   * dígitos, que PCI-DSS permite mostrar.
   */
  async verificarTarjeta(datos: DatosTarjeta): Promise<ResultadoVerificacionTarjeta> {
    const digitos = datos.numero.replace(/\D/g, '')
    return {
      ok: false,
      noSoportado: true,
      // Los últimos 4 son el único dato que se conserva, para que el huésped
      // reconozca cuál tarjeta dejó. Cuatro dígitos no identifican una tarjeta.
      ultimos4: digitos.length >= 4 ? digitos.slice(-4) : undefined,
      vencimiento: datos.vencimiento,
      detalle:
        'No hay pasarela de pagos contratada, así que la tarjeta no se pudo probar contra el emisor.',
    }
  }

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

    /*
      El estado y el tipo se VALIDAN contra el dominio; no se castean.

      Antes eran `(cuerpo.estado as EstadoPago) ?? 'aprobado'`, con dos problemas:

      · **`?? 'aprobado'` es fail-open sobre dinero.** Un evento al que le falte
        el campo se convertía en un cobro aprobado que nadie hizo. Ante un
        mensaje incompleto corresponde rechazarlo, no darlo por bueno.
      · **El `as` no verifica nada.** Un valor fuera del enum pasaba el tipado y
        explotaba recién en el `insert` contra `estado_pago`, devolviendo 500 y
        dejando a la pasarela reintentando en bucle un evento que nunca va a
        entrar.

      Hoy no hay proveedor real conectado. Se corrige igual, por la misma razón
      que se corrigió `verificarFirma`: el contrato es lo que va a heredar quien
      enchufe MercadoPago o Stripe, y un contrato mal hecho se copia sin leerlo.
    */
    const tipo = cuerpo.tipo ?? 'saldo'
    if (!TIPOS_PAGO.includes(tipo as TipoPago)) return null

    const estado = cuerpo.estado
    if (!ESTADOS_PAGO.includes(estado as EstadoPago)) return null

    return {
      externalId,
      reservaId,
      monto,
      medio: this.nombre,
      tipo: tipo as TipoPago,
      estado: estado as EstadoPago,
    }
  }
}

const PROVEEDORES: Record<string, PaymentProvider> = {
  mercadopago: new ProveedorStub('mercadopago'),
  stripe: new ProveedorStub('stripe'),
}

export function obtenerProveedor(nombre: string): PaymentProvider | null {
  return PROVEEDORES[nombre] ?? null
}
