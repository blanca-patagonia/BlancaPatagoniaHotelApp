import 'server-only'
import { interpretarIcalBooking } from './ical'
import { SIN_CAPACIDADES } from '.'
import type {
  CanalVentaProvider,
  CapacidadesCanal,
  DisponibilidadCanal,
  ReservaDeCanal,
  ResultadoEnvio,
} from '.'

/**
 * Proveedor de canal por **feed iCal** de Booking.com.
 *
 * Es la única sincronización automática que se puede tener sin ser Connectivity
 * Partner ni contratar un channel manager: el extranet expone una URL iCal por
 * habitación y se puede leer cada hora sin pedirle permiso a nadie.
 *
 * ── Configuración ───────────────────────────────────────────────────────────
 *
 * `BOOKING_ICAL_FEEDS` con una lista de `CODIGO_TIPO=url`, separadas por coma o
 * por salto de línea:
 *
 *     BOOKING_ICAL_FEEDS="HOST-DOBLE=https://admin.booking.com/...,CAB-4PAX=https://..."
 *
 * El código del tipo va del lado nuestro y **no** sale del feed: cada URL
 * corresponde a una habitación del extranet, y qué habitación es lo sabe quien
 * copió la URL. Es la limitación más incómoda del iCal.
 *
 * ── Lo que este proveedor NO hace ───────────────────────────────────────────
 *
 * `publicarDisponibilidad` devuelve `noSoportado`. **El canal puede sobrevender**:
 * nadie le dice qué nos queda libre. Es lo que declara `capacidades()` y lo que
 * la pantalla advierte con palabras.
 */

/** Techo de espera por feed. Igual criterio que `/api/salud` y las divisas. */
const TIMEOUT_MS = 8000

/** Un feed configurado: qué tipo de unidad representa y de dónde se lee. */
export interface FeedIcal {
  tipoUnidadCodigo: string
  url: string
}

/**
 * Lee la configuración de feeds.
 *
 * Formato tolerante a propósito: separadores coma o salto de línea, espacios
 * alrededor, y se ignoran las entradas mal formadas en vez de tirar todo abajo.
 * Quien pega estas URLs las copia del extranet a mano y va a dejar un espacio de
 * más; que eso rompa la sincronización completa sería desproporcionado.
 */
export function leerFeeds(crudo: string | undefined): FeedIcal[] {
  if (!crudo?.trim()) return []

  return crudo
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((entrada) => {
      // Se corta en el PRIMER `=`: la URL del extranet trae varios en su query.
      const i = entrada.indexOf('=')
      if (i <= 0) return null
      const tipoUnidadCodigo = entrada.slice(0, i).trim()
      const url = entrada.slice(i + 1).trim()
      if (!tipoUnidadCodigo || !url.startsWith('http')) return null
      return { tipoUnidadCodigo, url }
    })
    .filter((x): x is FeedIcal => x !== null)
}

export class ProveedorBookingIcal implements CanalVentaProvider {
  nombre = 'booking-ical'

  constructor(private readonly feeds: FeedIcal[] = leerFeeds(process.env.BOOKING_ICAL_FEEDS)) {}

  esReal(): boolean {
    return true
  }

  capacidades(): CapacidadesCanal {
    return {
      ...SIN_CAPACIDADES,
      // Lo único que sabe hacer: leer.
      traeReservas: true,
      trae: {
        // El feed no dice importes, contacto ni cuántas personas. El tipo de
        // unidad sí lo sabemos, pero por configuración, no por el feed.
        importes: false,
        contacto: false,
        huespedes: false,
        tipoUnidad: true,
      },
    }
  }

  /** Feeds configurados, para que la pantalla pueda mostrar si falta alguno. */
  feedsConfigurados(): FeedIcal[] {
    return this.feeds
  }

  /**
   * Lee todos los feeds y devuelve las reservas encontradas.
   *
   * `desde` se ignora: el feed de Booking no acepta filtro de fecha, siempre
   * devuelve la ventana completa que el extranet decide. No es un problema — la
   * idempotencia por `external_id` hace que releer lo mismo no duplique nada.
   *
   * Un feed que falla **no frena a los demás**: se registra y se sigue. Si un tipo
   * de unidad quedó sin sincronizar es mejor tener los otros cuatro que ninguno.
   */
  async traerReservas(): Promise<ReservaDeCanal[]> {
    if (this.feeds.length === 0) {
      console.warn('[canales:booking-ical] no hay feeds configurados en BOOKING_ICAL_FEEDS.')
      return []
    }

    const porFeed = await Promise.all(
      this.feeds.map(async (f) => {
        try {
          const r = await fetch(f.url, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: 'no-store',
            headers: { accept: 'text/calendar' },
          })

          if (!r.ok) {
            console.warn(`[canales:booking-ical] ${f.tipoUnidadCodigo} respondió ${r.status}.`)
            return []
          }

          const texto = await r.text()
          const resultado = interpretarIcalBooking(texto, f.tipoUnidadCodigo)

          if (resultado.rechazados.length > 0) {
            console.warn(
              `[canales:booking-ical] ${f.tipoUnidadCodigo}: ${resultado.rechazados.length} evento(s) descartado(s).`,
            )
          }

          return resultado.reservas
        } catch (e) {
          console.warn(
            `[canales:booking-ical] no se pudo leer ${f.tipoUnidadCodigo}: ${e instanceof Error ? e.message : e}`,
          )
          return []
        }
      }),
    )

    return porFeed.flat()
  }

  /**
   * No soportado: el iCal es de solo lectura.
   *
   * Devuelve `noSoportado` en vez de lanzar o de mentir con `ok: true`. Ver
   * `CapacidadesCanal`.
   */
  async publicarDisponibilidad(filas: DisponibilidadCanal[]): Promise<ResultadoEnvio> {
    return {
      ok: false,
      aceptadas: 0,
      noSoportado: true,
      error:
        `El feed iCal es de solo lectura: no se le puede publicar disponibilidad a Booking ` +
        `(${filas.length} fila(s) sin enviar). Como el canal no recibe nuestro cupo, puede ` +
        `sobrevender: seguir ofreciendo una unidad que el hotel ya vendió. Para sincronizar en ` +
        `dos direcciones hace falta un channel manager.`,
    }
  }

  /** El iCal no tiene webhooks: se consulta por sondeo. */
  async interpretarWebhook(): Promise<ReservaDeCanal | null> {
    return null
  }

  /**
   * No hay a quién acusar recibo.
   *
   * Devuelve `true` a propósito: para el llamador significa «no hace falta hacer
   * nada más», que es la verdad. Un `false` lo haría reintentar para siempre.
   */
  async confirmarRecepcion(): Promise<boolean> {
    return true
  }
}
