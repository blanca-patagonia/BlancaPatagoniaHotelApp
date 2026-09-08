import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
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
 * ⚠️ `tests/eventos-de-aviso.test.ts` verifica que ninguna de estas funciones
 * deje una variable declarada sin valor, comparando contra `PLANTILLAS`. Si una
 * plantilla suma un marcador y su disparador no lo llena, el test lo nombra.
 *
 * ── Ninguna de estas funciones corta la operación que la llamó ──────────────
 *
 * Devuelven `ResultadoEncolado` y nunca lanzan. Que no se pueda anotar un
 * recordatorio no justifica abortar un check-out; el error queda registrado por
 * `encolar`.
 */

/* ═══════════════════════════════════════════ avisos internos (cartelera) ══ */

/**
 * Entró una reserva.
 *
 * `origen` dice de dónde: el mostrador no necesita el aviso de lo que acaba de
 * cargar él mismo, pero sí el de lo que entró por la web a las tres de la
 * mañana o el de lo que bajó de un canal.
 */
export function avisarNuevaReserva(
  client: SupabaseClient,
  d: {
    reservaId: string
    codigo: string
    huesped: string
    checkIn: string
    checkOut: string
    total: number
    origen: string
  },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'interno_nueva_reserva',
    entidadId: d.reservaId,
    reservaId: d.reservaId,
    variables: {
      codigo: d.codigo,
      huesped: d.huesped,
      check_in: formatoFechaCorta(d.checkIn),
      check_out: formatoFechaCorta(d.checkOut),
      total: formatearUSD(d.total),
      origen: d.origen,
    },
  })
}

/** Se acreditó un pago. La entidad es el pago, no la reserva: hay varios por reserva. */
export function avisarPagoInterno(
  client: SupabaseClient,
  d: {
    pagoId: string
    reservaId: string
    codigo: string
    huesped: string
    importe: number
    medio: string
    saldo: number
  },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'interno_nuevo_pago',
    entidadId: d.pagoId,
    reservaId: d.reservaId,
    variables: {
      codigo: d.codigo,
      huesped: d.huesped,
      importe: formatearUSD(d.importe),
      medio: d.medio,
      saldo: formatearUSD(d.saldo),
    },
  })
}

/**
 * Falló la sincronización con un canal.
 *
 * ⚠️ El `discriminante` es el día, y es lo que hace útil al aviso. Sin él la
 * clave sería `interno_error_sincronizacion:<canal>` y el segundo fallo —el de
 * la semana siguiente— no se avisaría nunca. Con el día adentro, una corrida que
 * falla tres veces el mismo día sigue dejando un solo aviso, que es lo que hace
 * falta: el cron corre seguido y la cartelera no es un log.
 */
export function avisarErrorSincronizacion(
  client: SupabaseClient,
  d: { canal: string; detalle: string; dia: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'interno_error_sincronizacion',
    entidadId: d.canal,
    discriminante: d.dia,
    variables: { canal: d.canal, detalle: d.detalle },
  })
}

/**
 * Aterrizaron reservas de un canal y están sin importar.
 *
 * El `discriminante` es el día: se avisa una vez por día y por canal, no una por
 * corrida. El cron sondea seguido y la cartelera no es un log — repetir el mismo
 * aviso cada hora es la forma más rápida de que se deje de mirar.
 *
 * Como consecuencia, el número del aviso es el de la corrida que lo disparó
 * primero. Es lo correcto: dice «hay trabajo pendiente», y el número exacto está
 * en la pantalla de canales, que es a donde manda a ir.
 */
export function avisarCanalPorRevisar(
  client: SupabaseClient,
  d: { canal: string; cantidad: number; dia: string; conflictos?: number },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'interno_canal_por_revisar',
    entidadId: d.canal,
    discriminante: d.dia,
    variables: {
      canal: d.canal,
      cantidad: d.cantidad,
      aviso_conflicto:
        d.conflictos && d.conflictos > 0
          ? `\n\n⚠️ ${d.conflictos} de ellas chocan con el cupo: revisalas primero.`
          : '',
    },
  })
}

/** Lo facturado por el canal no coincide con lo devengado. */
export function avisarDiscrepanciaFactura(
  client: SupabaseClient,
  d: {
    cargoId: string
    canal: string
    devengado: number
    facturado: number
  },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'interno_discrepancia_factura',
    entidadId: d.cargoId,
    variables: {
      canal: d.canal,
      devengado: formatearUSD(d.devengado),
      facturado: formatearUSD(d.facturado),
      // La diferencia se calcula acá y no en el call site: es la resta que
      // alguien va a mirar, y hacerla en dos lugares es hacerla mal en uno.
      diferencia: formatearUSD(d.facturado - d.devengado),
    },
  })
}

/**
 * Una unidad quedó lista.
 *
 * El `discriminante` es el día: la misma habitación se limpia todos los días, y
 * sin él sólo se avisaría la primera vez en la vida de esa unidad.
 */
export function avisarHabitacionLista(
  client: SupabaseClient,
  d: { unidadId: string; unidad: string; dia: string; paraQuien?: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'interno_habitacion_lista',
    entidadId: d.unidadId,
    discriminante: d.dia,
    variables: {
      unidad: d.unidad,
      // Marcador opcional: sin llegada prevista la frase termina en el punto.
      para_quien: d.paraQuien ? ` para ${d.paraQuien}` : '',
    },
  })
}

/** Se abrió una orden de mantenimiento urgente. */
export function avisarIncidenteMantenimiento(
  client: SupabaseClient,
  d: { ordenId: string; unidad: string; titulo: string; prioridad: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'interno_incidente_mantenimiento',
    entidadId: d.ordenId,
    variables: { unidad: d.unidad, titulo: d.titulo, prioridad: d.prioridad },
  })
}

/* ═════════════════════════════════════════════════ avisos al huésped ══════ */

/** Datos que todo aviso al huésped necesita para saber a quién y por qué reserva. */
export interface DestinoHuesped {
  reservaId: string
  huespedId: string | null
  email: string | null
  /**
   * Teléfono, si se conoce. Con WhatsApp enchufado y plantilla aprobada, el
   * aviso sale por ahí en vez de por correo (ver `canalDelAviso`). Opcional
   * porque muchos call sites no lo tienen a mano, y sin él todo sigue por mail.
   */
  telefono?: string | null
  nombre: string
  codigo: string
}

/** La seña llegó: la reserva pasó a confirmada. */
export function avisarReservaConfirmada(
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { checkIn: string; checkOut: string; saldo: number },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'reserva_confirmada',
    entidadId: h.reservaId,
    destinatario: h.email,
    telefono: h.telefono,
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
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { pagoId: string; importe: number; saldo: number },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'pago_recibido',
    entidadId: d.pagoId,
    destinatario: h.email,
    telefono: h.telefono,
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
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { pagoId: string; importe: number; enlace: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'pago_rechazado',
    entidadId: d.pagoId,
    destinatario: h.email,
    telefono: h.telefono,
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
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { checkIn: string; checkOut: string; total: number },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'reserva_reprogramada',
    entidadId: h.reservaId,
    discriminante: `${d.checkIn}_${d.checkOut}`,
    destinatario: h.email,
    telefono: h.telefono,
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
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { checkIn: string; checkOut: string; detalle: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'reserva_cancelada',
    entidadId: h.reservaId,
    destinatario: h.email,
    telefono: h.telefono,
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
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { checkIn: string; detalle: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'no_show',
    entidadId: h.reservaId,
    destinatario: h.email,
    telefono: h.telefono,
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

/**
 * La reserva pendiente se libera mañana.
 *
 * El aviso que evita la peor sorpresa: una reserva sin seña se libera a los 5
 * días (`expirar_reservas_pendientes`) y hasta ahora eso pasaba en silencio — el
 * huésped creía tener la habitación y se enteraba al llegar.
 */
export function avisarReservaPorVencer(
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { checkIn: string; sena: number; enlace: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'reserva_por_vencer',
    entidadId: h.reservaId,
    destinatario: h.email,
    telefono: h.telefono,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      check_in: formatoFechaCorta(d.checkIn),
      sena: formatearUSD(d.sena),
      enlace: d.enlace,
    },
  })
}

/** Queda saldo y la llegada está cerca. El discriminante es la llegada. */
export function avisarSaldoPendiente(
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { checkIn: string; saldo: number; enlace: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'saldo_pendiente',
    entidadId: h.reservaId,
    discriminante: d.checkIn,
    destinatario: h.email,
    telefono: h.telefono,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      check_in: formatoFechaCorta(d.checkIn),
      saldo: formatearUSD(d.saldo),
      enlace: d.enlace,
    },
  })
}

/**
 * La salida es mañana.
 *
 * `avisoSaldo` viene vacío cuando no hay nada que cobrar: es preferible a dos
 * plantillas casi iguales, y a mandar «saldo: 0», que hace que alguien revise si
 * le están cobrando algo.
 */
export function avisarCheckoutProximo(
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { checkOut: string; saldo: number },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'checkout_proximo',
    entidadId: h.reservaId,
    discriminante: d.checkOut,
    destinatario: h.email,
    telefono: h.telefono,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: {
      nombre: h.nombre,
      codigo: h.codigo,
      check_out: formatoFechaCorta(d.checkOut),
      hora_check_out: HORA_CHECK_OUT,
      aviso_saldo:
        d.saldo > 0
          ? `Te queda un saldo de ${formatearUSD(d.saldo)} para abonar antes de irte.`
          : '',
    },
  })
}

/**
 * Pedido de reseña.
 *
 * ⚠️ El único evento **comercial** del catálogo: `encolar` lo bloquea si el
 * huésped no marcó `acepta_promociones`. La diferencia con los demás no es de
 * tono — los otros le informan algo de su reserva, éste le pide un favor al
 * hotel—, y es la que decide si hace falta opt-in.
 */
export function avisarSolicitudResena(
  client: SupabaseClient,
  h: DestinoHuesped,
  d: { enlace: string },
): Promise<ResultadoEncolado> {
  return encolar(client, {
    evento: 'solicitud_resena',
    entidadId: h.reservaId,
    destinatario: h.email,
    telefono: h.telefono,
    huespedId: h.huespedId,
    reservaId: h.reservaId,
    variables: { nombre: h.nombre, enlace: d.enlace },
  })
}
