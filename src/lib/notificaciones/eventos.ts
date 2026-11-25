import 'server-only'
import type { ClienteServicio } from '@/lib/supabase/admin'
import { formatearUSD } from '@/lib/domain/moneda'
import { formatoFechaCorta } from '@/lib/fechas'
import { HORA_CHECK_IN, HORA_CHECK_OUT } from '@/lib/domain/hotel'
import { encolar, type ResultadoEncolado } from './index'

/**
 * Los disparadores del catálogo de avisos, uno por evento.
 *
 * ── Por qué existe esta capa ────────────────────────────────────────────────
 *
 * `encolar` recibe `variables: Record<string, string | number>`, o sea que el
 * nombre de cada marcador se escribe **a mano en el call site**. Con cuatro
 * plantillas eso se sostenía; con veinte, repartidas entre acciones del panel,
 * webhooks y crons, es cuestión de tiempo que alguien escriba `check_in` donde
 * la plantilla dice `checkin` — y el resultado no es un error: es un correo que
 * sale con «{{check_in}}» impreso adentro.
 *
 * Acá cada evento tiene una función con parámetros **con nombre y tipo**. El
 * typecheck deja de mirar un diccionario suelto y pasa a mirar una firma, y el
 * formato de fechas e importes queda escrito una vez.
 *
 * ⚠️ `tests/dominio/eventos-de-aviso.test.ts` verifica que ninguna de estas funciones
 * deje una variable declarada sin valor, comparando contra `PLANTILLAS`. Si una
 * plantilla suma un marcador y su disparador no lo llena, el test lo nombra.
 *
 * ── Ninguna de estas funciones corta la operación que la llamó ──────────────
 *
 * Devuelven `ResultadoEncolado` y nunca lanzan. Que no se pueda anotar un
 * recordatorio no justifica abortar un check-out; el error queda registrado por
 * `encolar`.
 */

/* ═════════════════════════════════════════════════ avisos al huésped ══════ */

/** Datos que todo aviso al huésped necesita para saber a quién y por qué reserva. */
export interface DestinoHuesped {
  reservaId: string
  huespedId: string | null
  email: string | null
  nombre: string
  codigo: string
}

/** La seña llegó: la reserva pasó a confirmada. */
export function avisarReservaConfirmada(
  client: ClienteServicio,
  h: DestinoHuesped,
  d: { checkIn: string; checkOut: string; saldo: number },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'reserva_confirmada',
    entidadId: h.reservaId,
    destinatario: h.email,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      check_in: formatoFechaCorta(d.checkIn),
      check_out: formatoFechaCorta(d.checkOut),
      hora_check_in: HORA_CHECK_IN,
      hora_check_out: HORA_CHECK_OUT,
      saldo: formatearUSD(d.saldo),
    },
  })
}

/** Se acreditó un pago suyo. La entidad es el pago: puede haber varios. */
export function avisarPagoRecibido(
  client: ClienteServicio,
  h: DestinoHuesped,
  d: { pagoId: string; importe: number; saldo: number },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'pago_recibido',
    entidadId: d.pagoId,
    destinatario: h.email,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      importe: formatearUSD(d.importe),
      saldo: formatearUSD(d.saldo),
    },
  })
}

/**
 * La pasarela rechazó el pago.
 *
 * ⚠️ El correo **no dice por qué**: el motivo lo sabe el emisor de la tarjeta, no
 * el hotel, y arriesgar una explicación ajena («fondos insuficientes») donde
 * pudo ser otra cosa es peor que no decir nada.
 */
export function avisarPagoRechazado(
  client: ClienteServicio,
  h: DestinoHuesped,
  d: { pagoId: string; importe: number; enlace: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'pago_rechazado',
    entidadId: d.pagoId,
    destinatario: h.email,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      importe: formatearUSD(d.importe),
      enlace: d.enlace,
    },
  })
}

/**
 * Cambiaron las fechas.
 *
 * El `discriminante` es el período nuevo: reprogramar dos veces la misma reserva
 * son dos avisos, y tienen que serlo.
 */
export function avisarReservaReprogramada(
  client: ClienteServicio,
  h: DestinoHuesped,
  d: { checkIn: string; checkOut: string; total: number },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'reserva_reprogramada',
    entidadId: h.reservaId,
    discriminante: `${d.checkIn}_${d.checkOut}`,
    destinatario: h.email,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      check_in: formatoFechaCorta(d.checkIn),
      check_out: formatoFechaCorta(d.checkOut),
      hora_check_in: HORA_CHECK_IN,
      hora_check_out: HORA_CHECK_OUT,
      total: formatearUSD(d.total),
    },
  })
}

/**
 * La reserva se canceló.
 *
 * `detalle` lo arma quien cancela con la política que corresponda (Tarifario:
 * >14 días sin cargo, 14–7 la primera noche, <7 el 100 %). No se calcula acá:
 * la plantilla no conoce la política, y meterle la regla la dejaría
 * desactualizada el día que cambie.
 */
export function avisarReservaCancelada(
  client: ClienteServicio,
  h: DestinoHuesped,
  d: { checkIn: string; checkOut: string; detalle: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'reserva_cancelada',
    entidadId: h.reservaId,
    destinatario: h.email,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      check_in: formatoFechaCorta(d.checkIn),
      check_out: formatoFechaCorta(d.checkOut),
      detalle_cancelacion: d.detalle,
    },
  })
}

/** No se presentó. */
export function avisarNoShow(
  client: ClienteServicio,
  h: DestinoHuesped,
  d: { checkIn: string; detalle: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'no_show',
    entidadId: h.reservaId,
    destinatario: h.email,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      check_in: formatoFechaCorta(d.checkIn),
      detalle_cancelacion: d.detalle,
    },
  })
}

