import 'server-only'

/**
 * Contrato del puerto de pagos.
 *
 * Vive separado de `index.ts` para que las implementaciones (simulado,
 * MercadoPago, Stripe) puedan importarlo sin que el registro las importe a
 * ellas primero, que es como se arma un ciclo.
 *
 * Lo que este contrato asume, y conviene tener a mano:
 *
 * · **El `externalId` lo genera el sistema, no la pasarela.** Se decide antes
 *   de llamar a nadie y se guarda en `pagos.external_id` (UNIQUE) junto con una
 *   fila `pendiente`. Esa fila es la que hace idempotente al webhook y la que
 *   sabe cuánto se pidió cobrar. Si lo generara la pasarela habría una ventana
 *   —entre el redirect y la respuesta— en la que el sistema no sabe qué está
 *   por cobrar.
 * · **`monto` viaja en la moneda que se cobra**, no en USD. La conversión ya se
 *   hizo (`lib/domain/cobro.ts`) y quedó congelada en la fila del pago.
 */

import type { MonedaCobro } from '@/lib/domain/cobro'
import type { MedioPago, TipoPago, EstadoPago } from '@/lib/domain/pagos'

/** A dónde vuelve el huésped cuando termina en la pasarela. */
export interface UrlsDeRetorno {
  exito: string
  error: string
  /** Efectivo en Rapipago: el huésped ya salió de la pasarela pero no pagó todavía. */
  pendiente: string
}

export interface CheckoutParams {
  reservaId: string
  /** Lo genera el sistema y ya está guardado en `pagos.external_id`. */
  externalId: string
  /** En `moneda`. Es exactamente lo que se le va a cobrar. */
  monto: number
  moneda: MonedaCobro
  descripcion: string
  tipo: Extract<TipoPago, 'senia' | 'saldo'>
  urls: UrlsDeRetorno
  /** Para que la pasarela le mande el comprobante y precargue el formulario. */
  emailComprador?: string
  venceEn: Date
}

export interface CheckoutResult {
  /** A dónde mandar al huésped. */
  url: string
  externalId: string
}

/**
 * Un checkout que no se pudo crear.
 *
 * Se devuelve en vez de lanzar porque el llamador tiene que poder mostrarle algo
 * útil al huésped y **deshacer la fila `pendiente`** que ya escribió. Una
 * excepción atravesando la Server Action dejaría un pago fantasma esperando un
 * webhook que nunca va a llegar.
 */
export interface CheckoutFallido {
  error: string
}

export type ResultadoCheckout = CheckoutResult | CheckoutFallido

export function falloElCheckout(r: ResultadoCheckout): r is CheckoutFallido {
  return 'error' in r
}

/**
 * Qué salió de leer un webhook.
 *
 * Los tres casos existen porque **«no me interesa» y «está roto» piden
 * respuestas HTTP opuestas**, y confundirlos rompe la integración:
 *
 * · `evento`   → registrar el pago. Responde 200.
 * · `ignorar`  → el aviso es legítimo pero no habla de un cobro nuestro. Stripe
 *   manda decenas de tipos de evento por suscripción; MercadoPago avisa de
 *   planes y facturas. Responde **200**: es la forma de decirle a la pasarela
 *   «recibido, no lo reintentes». Si acá se respondiera 400, la pasarela
 *   acumularía fallos y **terminaría deshabilitando el endpoint**, con lo cual
 *   el hotel dejaría de enterarse también de los pagos de verdad.
 * · `invalido`  → el aviso vino mal o no se pudo interpretar. Responde 400 y
 *   queda en el log. Es **definitivo**: reintentarlo daría igual.
 * · `reintentar` → el aviso puede estar perfecto y falló algo de este lado o de
 *   la API de la pasarela (timeout al consultar el pago, 500 del proveedor).
 *   Responde **500**, que es como se le pide a una pasarela que vuelva a
 *   intentar. Distinguirlo de `invalido` importa: con 400, MercadoPago descarta
 *   el aviso para siempre y **ese cobro no se entera nunca más**, aunque el
 *   problema haya durado dos segundos.
 */
export type ResultadoWebhook =
  | { tipo: 'evento'; evento: WebhookEvent }
  | { tipo: 'ignorar'; motivo: string }
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'reintentar'; motivo: string }

/** Evento normalizado que produce un webhook, sea cual sea la pasarela. */
export interface WebhookEvent {
  externalId: string
  /**
   * Puede venir vacío: no todas las pasarelas devuelven la metadata en todos
   * los eventos. El webhook lo resuelve leyendo la fila del pago, que es la
   * fuente autoritativa; esto es solo el respaldo para un pago que el sistema
   * no originó.
   */
  reservaId: string
  /** En `moneda`, tal como lo informa la pasarela. **No es USD.** */
  monto: number
  moneda: MonedaCobro
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
  /** ¿Puede generar un link de pago de verdad, contra la pasarela? */
  cobraEnLinea: boolean
  /** Monedas en las que este proveedor puede cobrar. */
  monedas: readonly MonedaCobro[]
}

/** Datos de la tarjeta que viajan a la pasarela y **nunca** se guardan acá. */
export interface DatosTarjeta {
  /**
   * Número de tarjeta. Se usa para llamar a la pasarela y se descarta.
   *
   * ⚠️ NUNCA persistir este valor. Las migraciones 0059 y 0067 tienen
   * restricciones que rechazan un PAN en las columnas de garantía y de pago, y
   * hay un test-contrato que falla si alguna columna nueva pudiera contener uno
   * (ADR 0025).
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
  /** `false` cuando es un simulador: no llama a ningún servicio externo (ADR 0018). */
  esReal(): boolean
  /** Qué sabe hacer este proveedor. La pantalla lo usa para no prometer de más. */
  capacidades(): CapacidadesPago
  /**
   * Crea el checkout contra la pasarela.
   *
   * **No lanza**: devuelve `{ error }` para que el llamador pueda borrar la fila
   * `pendiente` que ya escribió y contarle al huésped qué pasó.
   */
  crearCheckout(p: CheckoutParams): Promise<ResultadoCheckout>
  verificarFirma(req: Request): Promise<boolean>
  parsearWebhook(req: Request): Promise<ResultadoWebhook>
  /**
   * Preautoriza la tarjeta contra el emisor y devuelve un token.
   *
   * Un proveedor que no puede hacerlo devuelve `{ ok: false, noSoportado: true }`.
   * **No lanza y no miente diciendo `ok: true`.**
   */
  verificarTarjeta(datos: DatosTarjeta): Promise<ResultadoVerificacionTarjeta>
}
