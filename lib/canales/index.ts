import 'server-only'
import { seleccionarProveedor } from '@/lib/integraciones/seleccion'

/**
 * Abstracción de canales de venta externos (OTA): `CanalVentaProvider`.
 *
 * Mismo patrón que los otros cinco adaptadores del proyecto (`PaymentProvider`,
 * `EmailProvider`, `FirmaElectronicaProvider`, `FacturacionElectronicaProvider`,
 * `AsistenteProvider`): interfaz en el lenguaje del dominio + simulador, y el
 * proveedor real se enchufa cambiando una variable de entorno.
 *
 * ── Qué modela y por qué así ────────────────────────────────────────────────
 *
 * Integrarse con Booking.com no es «llamar a una API»: son tres flujos que van
 * en direcciones distintas y que fallan de formas distintas.
 *
 *  1. **ARI** (Availability, Rates, Inventory) — *nosotros → el canal*. Se
 *     empuja cuánto hay libre y a qué precio. Si esto se atrasa, el canal vende
 *     lo que ya no existe: **overbooking**, que es justo lo que el ADR 0002
 *     protege del lado nuestro y que ninguna restricción de nuestra base puede
 *     impedir del lado de ellos.
 *  2. **Reservas** — *el canal → nosotros*. Llegan altas, modificaciones y
 *     cancelaciones. Se toman por webhook o por sondeo, según el canal.
 *  3. **Confirmación** — *nosotros → el canal*. Se acusa recibo. Sin esto el
 *     canal reenvía la misma reserva indefinidamente.
 *
 * ── Decisiones que este contrato fija ───────────────────────────────────────
 *
 * · **Idempotencia por `externalId`.** Los canales reenvían: toda operación de
 *   entrada trae el identificador del canal y la implementación debe poder
 *   procesarla dos veces sin duplicar. Es el mismo criterio que ya usa
 *   `pagos.external_id`.
 * · **El canal nunca fija el precio de nuestra base.** Manda lo que cobró, que
 *   se guarda como referencia; la cuenta del hotel se calcula con nuestro
 *   dominio (`lib/domain/precios.ts`) y tarifa **neto** (ADR 0004), porque una
 *   reserva de OTA es venta de agencia.
 * · **Nada se escribe desde acá.** Este módulo traduce; quien persiste es
 *   `lib/reservas/crear.ts`, que ya tiene el alta atómica anti-overbooking.
 *
 * ⚠️ El proveedor `simulado` NO habla con ningún canal. En producción, usarlo
 * tiene que ser una decisión declarada: `seleccionarProveedor` lanza si la
 * variable falta (ADR 0018).
 */

/** Canales soportados por el dominio (`reservas.canal`). */
export type CanalVenta = 'booking' | 'expedia'

/* ───────────────────────────────────────────────────── salientes (ARI) ──── */

export interface DisponibilidadCanal {
  /** Código del tipo de unidad tal como lo conoce el canal. */
  tipoUnidadCodigo: string
  fecha: string
  /** Unidades libres para vender ese día. */
  cupo: number
  /** Precio por noche en la moneda del canal. */
  precio: number
  moneda: string
  /** Estancia mínima, si el hotel la impone ese día. */
  minimoNoches?: number
  /** Cierra la venta de ese día sin tocar el cupo. */
  cerrado?: boolean
}

export interface ResultadoEnvio {
  ok: boolean
  /** Cuántas filas aceptó el canal. Sirve para detectar rechazos parciales. */
  aceptadas: number
  error?: string
}

/* ───────────────────────────────────────────────────── entrantes ──────── */

/** Una reserva tal como la entrega el canal, ya normalizada a nuestro lenguaje. */
export interface ReservaDeCanal {
  /** Identificador en el canal. Es la clave de idempotencia. */
  externalId: string
  canal: CanalVenta
  tipoUnidadCodigo: string
  checkIn: string
  checkOut: string
  huespedes: number
  huesped: {
    apellido: string
    nombre: string
    email: string | null
    telefono: string | null
    /** País emisor, que el canal casi siempre manda y sirve para estadística. */
    pais?: string | null
  }
  /**
   * Importe que el canal informa haber cobrado o comprometido.
   *
   * Es **referencia**, no la cuenta: el total se recalcula con nuestro dominio.
   * Guardarlo permite detectar discrepancias en la conciliación.
   */
  importeCanal: number
  monedaCanal: string
  /** Comisión declarada por el canal, si la informa. */
  comision?: number | null
  notas?: string | null
  /** `nueva`, `modificada` o `cancelada`: el canal manda las tres por el mismo camino. */
  operacion: 'nueva' | 'modificada' | 'cancelada'
  /** Momento del evento en el canal, para resolver llegadas fuera de orden. */
  emitidaEn: string
}

export interface CanalVentaProvider {
  nombre: string
  /** `false` cuando es un simulador: no habla con ningún canal real. */
  esReal(): boolean

  /** Empuja disponibilidad y tarifas al canal. */
  publicarDisponibilidad(filas: DisponibilidadCanal[]): Promise<ResultadoEnvio>

  /** Trae las reservas nuevas o modificadas desde el último sondeo. */
  traerReservas(desde: string): Promise<ReservaDeCanal[]>

  /**
   * Interpreta y valida un webhook del canal.
   *
   * Devuelve `null` si la firma no valida o el cuerpo es ilegible: el llamador
   * responde 401/400 sin distinguir cuál de las dos cosas fue, para no ayudar a
   * quien esté probando.
   */
  interpretarWebhook(req: Request): Promise<ReservaDeCanal | null>

  /** Acusa recibo. Sin esto el canal reenvía la reserva indefinidamente. */
  confirmarRecepcion(externalId: string): Promise<boolean>
}

/* ───────────────────────────────────────────────────── simulador ──────── */

/**
 * Proveedor simulado.
 *
 * No habla con ningún canal: acepta todo lo que se le publica y no devuelve
 * reservas. Existe para que el resto del sistema —la pantalla que muestra el
 * estado de sincronización, el job que publica ARI, los tests— se pueda
 * construir y probar sin credenciales de Booking.
 */
class CanalSimulado implements CanalVentaProvider {
  nombre = 'simulado'

  esReal(): boolean {
    return false
  }

  async publicarDisponibilidad(filas: DisponibilidadCanal[]): Promise<ResultadoEnvio> {
    // Se validan las filas igual que lo haría un canal real: así los errores de
    // armado se descubren en desarrollo y no el día de la integración.
    for (const f of filas) {
      if (f.cupo < 0) return { ok: false, aceptadas: 0, error: `Cupo negativo en ${f.fecha}.` }
      if (f.precio < 0) return { ok: false, aceptadas: 0, error: `Precio negativo en ${f.fecha}.` }
    }
    return { ok: true, aceptadas: filas.length }
  }

  async traerReservas(): Promise<ReservaDeCanal[]> {
    return []
  }

  async interpretarWebhook(): Promise<ReservaDeCanal | null> {
    return null
  }

  async confirmarRecepcion(): Promise<boolean> {
    return true
  }
}

const PROVEEDORES: Record<string, CanalVentaProvider> = {
  simulado: new CanalSimulado(),
}

/**
 * Proveedor de canal vigente.
 *
 * Con `CANAL_PROVIDER=booking` —cuando exista esa implementación— el sistema
 * pasaría a sincronizar de verdad sin tocar el dominio ni las pantallas.
 */
export function obtenerProveedorCanal(
  nombre: string | undefined = process.env.CANAL_PROVIDER,
): CanalVentaProvider {
  return seleccionarProveedor({
    variable: 'CANAL_PROVIDER',
    proveedores: PROVEEDORES,
    simulado: 'simulado',
    valor: nombre,
  })
}
