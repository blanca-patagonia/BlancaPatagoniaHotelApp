import { ZONA_HOTEL } from '@/lib/fechas'
import type { EventoEmail } from './plantillas'

/**
 * Reglas de la bandeja de salida (migración 0075).
 *
 * Puro y testeable: cuándo se reintenta, a qué hora se puede escribir y si el
 * huésped dio permiso. Nada de esto habla con la base ni con un proveedor.
 */

/* ─────────────────────────────────────────────── reintentos con espera ──── */

/**
 * Cuántas veces se reintenta antes de darla por fallida.
 *
 * Cinco intentos repartidos en ~12 horas cubren la clase de fallo que motiva los
 * reintentos —la API del proveedor caída un rato, un límite de tasa, una red que
 * cortó—. Más allá de eso el problema no es transitorio y seguir intentando sólo
 * esconde que hay algo que arreglar.
 */
export const MAX_INTENTOS = 5

/**
 * Espera antes del intento número `intentos + 1`, en minutos.
 *
 * Creciente y **acotada**: sin techo, el quinto intento caería días después y el
 * recordatorio de check-in llegaría con el huésped ya alojado. Un mensaje que
 * llega tarde puede ser peor que uno que no llega — el de check-out avisando de
 * la salida de ayer confunde más de lo que ayuda.
 */
export function esperaDeReintento(intentos: number): number {
  const escala = [1, 5, 30, 120, 360]
  const i = Math.max(0, Math.min(intentos, escala.length - 1))
  return escala[i]
}

/** ¿Se agotaron los intentos? */
export function agotoIntentos(intentos: number): boolean {
  return intentos >= MAX_INTENTOS
}

/* ──────────────────────────────────────────────── horario permitido ──── */

/** Desde qué hora del hotel se puede escribir (inclusive). */
export const HORA_DESDE = 9
/** Hasta qué hora (exclusive). */
export const HORA_HASTA = 21

/**
 * Eventos que se mandan **al instante**, sin esperar al horario.
 *
 * Son aquellos en los que el huésped está **esperando** el mensaje: acaba de
 * reservar y quiere su confirmación, o acaba de pagar. Demorar eso hasta las 9 de
 * la mañana no es cortesía, es dejarlo sin saber si su reserva entró.
 *
 * El resto —recordatorios, encuestas, avisos de fidelidad— sí espera: son
 * mensajes que el hotel inicia, y llegar a las 3 de la mañana es molestar.
 */
const INMEDIATOS: readonly EventoEmail[] = ['confirmacion_reserva']

export function esInmediato(evento: EventoEmail): boolean {
  return INMEDIATOS.includes(evento)
}

/** La hora del hotel para un instante dado, sin depender de la del servidor. */
export function horaDelHotel(en: Date): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_HOTEL,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(en)
  return Number(partes.find((p) => p.type === 'hour')?.value ?? 0)
}

/** ¿Está dentro de la franja en la que se le puede escribir al huésped? */
export function dentroDeHorario(en: Date): boolean {
  const h = horaDelHotel(en)
  return h >= HORA_DESDE && h < HORA_HASTA
}

/**
 * Cuándo corresponde intentar el envío.
 *
 * `null` significa «ahora». Si el evento respeta horario y estamos fuera de la
 * franja, se corre al próximo comienzo de franja.
 *
 * ⚠️ La hora se calcula en `ZONA_HOTEL` y no en la del servidor. Vercel corre en
 * UTC: con `getHours()` pelado, la franja del hotel se movería tres horas y los
 * recordatorios saldrían de madrugada — es el mismo defecto que la auditoría
 * anterior encontró en `hoyISO()`.
 */
export function cuandoEnviar(evento: EventoEmail, ahora: Date): Date | null {
  if (esInmediato(evento)) return null
  if (dentroDeHorario(ahora)) return null

  const h = horaDelHotel(ahora)
  // Antes de la franja: hoy a las 9. Después: mañana a las 9.
  const dias = h >= HORA_HASTA ? 1 : 0
  const destino = new Date(ahora)
  destino.setUTCDate(destino.getUTCDate() + dias)
  // `HORA_DESDE` es hora del hotel (UTC−3), así que en UTC es +3.
  destino.setUTCHours(HORA_DESDE + 3, 0, 0, 0)
  return destino
}

/* ────────────────────────────────────────────────── consentimiento ──── */

export interface PreferenciasHuesped {
  acepta_avisos: boolean
  acepta_promociones: boolean
}

/**
 * Eventos comerciales, que exigen opt-in explícito.
 *
 * Hoy ninguno de los cuatro lo es: los cuatro hablan de la propia reserva del
 * huésped. La lista existe para que el día que se agregue una promoción alguien
 * tenga que decidir a conciencia de qué lado va, en vez de que salga por el
 * mismo camino que la confirmación.
 */
const COMERCIALES: readonly EventoEmail[] = []

export function esComercial(evento: EventoEmail): boolean {
  return COMERCIALES.includes(evento)
}

/**
 * ¿Se le puede mandar este mensaje a este huésped?
 *
 * Devuelve el motivo del rechazo, o `null` si se puede. Un motivo en vez de un
 * booleano porque la pantalla tiene que poder decir **por qué** no se le avisó:
 * «no se le mandó» sin explicación se lee como una falla del sistema.
 */
export function motivoNoNotificar(
  evento: EventoEmail,
  prefs: PreferenciasHuesped | null,
): string | null {
  if (!prefs) return null // Sin ficha de preferencias no se bloquea nada.
  if (esComercial(evento)) {
    return prefs.acepta_promociones ? null : 'El huésped no aceptó recibir comunicaciones comerciales.'
  }
  return prefs.acepta_avisos ? null : 'El huésped pidió no recibir avisos.'
}

/* ──────────────────────────────────────────────────────── la clave ──── */

/**
 * Clave de idempotencia del mensaje.
 *
 * Es lo que hace que reprocesar un webhook o reintentar una acción **no** mande
 * dos correos: la segunda inserción choca con el `unique` de la 0075.
 *
 * `discriminante` es para los eventos que sí pueden repetirse legítimamente sobre
 * la misma entidad —un recordatorio por cada estadía, no uno por reserva— y por
 * eso es explícito: que quien agrega un evento nuevo tenga que pensar si el suyo
 * se manda una vez o varias.
 */
export function claveDeNotificacion(
  evento: EventoEmail,
  entidadId: string,
  discriminante?: string,
): string {
  return discriminante ? `${evento}:${entidadId}:${discriminante}` : `${evento}:${entidadId}`
}
