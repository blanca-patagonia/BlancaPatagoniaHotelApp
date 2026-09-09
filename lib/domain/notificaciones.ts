import { ZONA_HOTEL } from '@/lib/fechas'
import { EVENTOS_INTERNOS, esInterno, type EventoEmail } from './plantillas'
import type { Rol } from './roles'

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
const INMEDIATOS: readonly EventoEmail[] = [
  // El huésped está esperando: acaba de reservar, de pagar, o de que le
  // rechacen el pago y quiere reintentar.
  'confirmacion_reserva',
  'reserva_confirmada',
  'pago_recibido',
  'pago_rechazado',
  // Se acordaron por teléfono o en el mostrador hace un minuto: llegar mañana a
  // las 9 haría dudar de si se registró.
  'reserva_reprogramada',
  'reserva_cancelada',
  // La reserva se libera mañana. Esperar al horario le come horas al aviso.
  'reserva_por_vencer',
]

export function esInmediato(evento: EventoEmail): boolean {
  // Los internos no molestan a nadie: aterrizan en la cartelera del hotel, no en
  // el teléfono de un huésped. La franja horaria protege al huésped, no al staff,
  // y demorar un aviso operativo hasta las 9 es justamente lo contrario de lo que
  // se busca — «entró una reserva» sirve cuando entró.
  if (esInterno(evento)) return true
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

/* ────────────────────────────────────────────── los estados del envío ──── */

/**
 * Los estados de un aviso, en el orden en que ocurren.
 *
 * ⚠️ **`enviada` no es `entregada`, y la diferencia es el rebote.** El proveedor
 * acepta el mensaje y responde 200 mucho antes de saber si el servidor del
 * destinatario lo aceptó. Entre esas dos cosas está el caso que el hotel
 * necesita ver —«le escribimos y no le llegó»—, y tratarlas como una sola lo
 * deja invisible.
 *
 * `cancelada` está al final y fuera de la progresión: no es un desenlace del
 * envío sino una decisión de no mandarlo.
 */
export const ESTADOS_NOTIFICACION = [
  'pendiente',
  'enviada',
  'entregada',
  'leida',
  'fallida',
  'cancelada',
] as const

export type EstadoNotificacion = (typeof ESTADOS_NOTIFICACION)[number]

export function esEstadoNotificacion(v: string): v is EstadoNotificacion {
  return (ESTADOS_NOTIFICACION as readonly string[]).includes(v)
}

export const ETIQUETAS_ESTADO: Record<EstadoNotificacion, string> = {
  pendiente: 'Pendiente',
  enviada: 'Enviada',
  entregada: 'Entregada',
  leida: 'Leída',
  fallida: 'Fallida',
  cancelada: 'Cancelada',
}

/**
 * Qué significa cada estado, en palabras que sirvan en el mostrador.
 *
 * Está en el dominio y no en la pantalla porque es la definición del estado, no
 * su presentación: la misma frase tiene que valer en el listado, en la Ayuda y
 * en cualquier informe.
 */
export const SIGNIFICADO_ESTADO: Record<EstadoNotificacion, string> = {
  pendiente: 'Todavía no salió: está esperando su turno.',
  enviada: 'El proveedor la aceptó. Todavía no se sabe si llegó a destino.',
  entregada: 'El servidor del destinatario la recibió.',
  leida: 'Se abrió. Que NO lo diga no prueba lo contrario: muchos clientes de correo bloquean la señal.',
  fallida: 'Se intentó varias veces y no se pudo. Se puede reintentar a mano.',
  cancelada: 'Se decidió no mandarla.',
}

/**
 * ¿Se puede volver a poner en cola?
 *
 * Sólo lo fallido y lo cancelado: reintentar algo que ya salió mandaría el
 * mismo aviso dos veces, que es exactamente lo que la bandeja existe para
 * evitar. Y lo pendiente no necesita reintento —ya está en la cola—; ofrecerlo
 * sugeriría que está trabado cuando sólo está esperando.
 */
export function sePuedeReintentar(estado: string): boolean {
  return estado === 'fallida' || estado === 'cancelada'
}

/**
 * ¿Se puede frenar antes de que salga?
 *
 * Sólo lo pendiente: es lo único que todavía no salió. Cancelar algo ya enviado
 * no lo trae de vuelta —el correo está en la casilla del huésped— y marcarlo
 * como cancelado sería falsear el registro de lo que pasó.
 *
 * Existe para el caso feo: un despliegue que encoló avisos equivocados. El
 * procedimiento completo está en `docs/despliegue.md` §3.5, y el orden importa:
 * primero se frena el cron, después se cancela.
 */
export function sePuedeCancelar(estado: string): boolean {
  return estado === 'pendiente'
}

/* ──────────────────────────────────────── a quién le toca cada interno ──── */

/**
 * El rol al que le corresponde cada aviso interno.
 *
 * ── Por qué un rol y no una persona ─────────────────────────────────────────
 *
 * «Recepción» sigue existiendo cuando cambia quien atiende el mostrador; una
 * casilla personal, no. Es el mismo criterio con el que están hechos los
 * permisos del sistema.
 *
 * ── Por qué rutear en vez de mandarle todo a todos ──────────────────────────
 *
 * Porque el ruido es lo que hace que después nadie mire la cartelera. Un aviso
 * de «pago acreditado: USD 120» no le sirve a quien está limpiando una
 * habitación, y si la mitad de lo que ve no le sirve, deja de mirarla — y ahí se
 * pierde también el que sí importaba.
 *
 * ⚠️ Es **ruteo, no un secreto**: admin y gerencia ven todo (supervisan), y los
 * datos de un aviso ya son visibles en la pantalla del módulo que lo originó.
 */
export const ROL_DEL_AVISO: Record<(typeof EVENTOS_INTERNOS)[number], Rol> = {
  // El mostrador es el que arma la llegada y el que cobra.
  interno_nueva_reserva: 'recepcion',
  interno_nuevo_pago: 'recepcion',
  // La sincronización que se rompe deja de traer reservas, y el que decide qué
  // hacer con eso —llamar al canal, cargarlas a mano— es gerencia.
  interno_error_sincronizacion: 'gerencia',
  // Las entrantes las importa y las atiende el mostrador: es trabajo diario, y
  // por eso `canales` está entre las áreas de recepción.
  interno_canal_por_revisar: 'recepcion',
  // Corregir una reserva que el canal cambió es trabajo del mostrador: abre la
  // ficha, reprograma y recotiza. Gerencia se entera igual, porque ve todo.
  interno_reserva_modificada_canal: 'recepcion',
  // Plata que se factura distinto de lo que se devengó: se revisa antes de pagar.
  interno_discrepancia_factura: 'gerencia',
  // La habitación lista la espera el mostrador para poder asignarla.
  interno_habitacion_lista: 'recepcion',
  // Un incidente urgente se resuelve contratando o mandando a alguien.
  interno_incidente_mantenimiento: 'gerencia',
}

/**
 * A qué rol le toca. `null` para los avisos que van al huésped: ahí el
 * destinatario es una dirección de correo, no un puesto del hotel.
 */
export function rolDelAviso(evento: EventoEmail): Rol | null {
  if (!esInterno(evento)) return null
  return ROL_DEL_AVISO[evento as (typeof EVENTOS_INTERNOS)[number]]
}

/* ────────────────────────────────────────────────── consentimiento ──── */

export interface PreferenciasHuesped {
  acepta_avisos: boolean
  acepta_promociones: boolean
}

/**
 * Eventos comerciales, que exigen opt-in explícito.
 *
 * El criterio no es el tono: es de quién es el interés. Todos los demás le
 * informan al huésped algo de **su** reserva —que entró, que se pagó, que se
 * canceló—; el pedido de reseña le pide un favor **al hotel**. Esa diferencia es
 * la que decide si hace falta `acepta_promociones`.
 *
 * La encuesta de satisfacción NO está acá y es deliberado: sirve para arreglar lo
 * que estuvo mal en la estadía de esa persona, así que es parte de la operación.
 * El pedido de reseña pública, en cambio, es marketing.
 */
const COMERCIALES: readonly EventoEmail[] = ['solicitud_resena']

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
  /*
    Un aviso interno no pasa por el consentimiento de nadie: va a la cartelera
    del hotel, no al huésped. Preguntarle a `acepta_avisos` si el hotel puede
    enterarse de que entró una reserva no tiene sentido — y si el aviso llevara
    un `huesped_id` para poder enlazarlo, el que dijo «no me escriban» dejaría al
    hotel sin la novedad.
  */
  if (esInterno(evento)) return null
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
