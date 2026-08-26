/**
 * Dominio de pagos (lógica pura).
 *
 * Regla del Tarifario: la reserva se bloquea con el pago de la **seña**
 * (equivalente a la primera noche); el resto es el **saldo**. Los reembolsos
 * descuentan de lo pagado.
 */

export const MEDIOS_PAGO = ['efectivo', 'transferencia', 'tarjeta', 'mercadopago', 'stripe'] as const
export type MedioPago = (typeof MEDIOS_PAGO)[number]

export const TIPOS_PAGO = ['senia', 'saldo', 'reembolso'] as const
export type TipoPago = (typeof TIPOS_PAGO)[number]

export const ESTADOS_PAGO = ['pendiente', 'aprobado', 'rechazado', 'reembolsado'] as const
export type EstadoPago = (typeof ESTADOS_PAGO)[number]

export const ETIQUETAS_MEDIO: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  mercadopago: 'MercadoPago',
  stripe: 'Stripe',
}

export const ETIQUETAS_TIPO_PAGO: Record<TipoPago, string> = {
  senia: 'Seña',
  saldo: 'Saldo',
  reembolso: 'Reembolso',
}

export interface Pago {
  tipo: TipoPago
  monto: number
  estado: EstadoPago
}

export interface ResumenPagos {
  pagado: number // aprobados (seña + saldo) menos reembolsos
  saldo: number // lo que falta para cubrir el total
  saldada: boolean
  tieneSenia: boolean
}

/**
 * Estados en los que la plata YA se movió. De estos no se sale nunca.
 *
 * `rechazado` **no está acá**, y esa ausencia es el punto: un rechazo no es
 * plata que se movió, es plata que no se movió. La misma intención de pago
 * puede seguir prosperando después.
 */
export const ESTADOS_PAGO_TERMINALES: readonly EstadoPago[] = ['aprobado', 'reembolsado']

/**
 * Transiciones admitidas, escritas una por una.
 *
 * Se prefiere la tabla explícita a dos reglas booleanas porque acá cada casillero
 * tiene un motivo distinto y conviene poder leerlos:
 *
 * · `pendiente → *`         el curso normal de cualquier link de pago.
 * · `rechazado → aprobado`  **el reintento**, y es el caso caro. Una pasarela
 *   real crea varios intentos bajo la misma referencia externa: la tarjeta se
 *   rechaza por fondos, el huésped pone otra y el segundo intento aprueba. Los
 *   dos eventos llegan con el mismo `external_id`. Si el rechazo trabara la
 *   fila, la reserva **no se saldaría nunca con la plata ya cobrada** y el
 *   huésped llegaría al mostrador figurando como impago. Es exactamente el bug
 *   que este módulo se escribió para evitar, un intento más adelante.
 * · `rechazado → reembolsado` no existe: no hay qué devolver.
 * · Nada vuelve a `pendiente`: las pasarelas **no garantizan el orden de
 *   entrega** y un `pendiente` atrasado no puede degradar un cobro confirmado.
 */
const TRANSICIONES: Record<EstadoPago, readonly EstadoPago[]> = {
  pendiente: ['aprobado', 'rechazado', 'reembolsado'],
  rechazado: ['aprobado'],
  aprobado: [],
  reembolsado: [],
}

/**
 * ¿Corresponde mover un pago de `actual` a `entrante`?
 *
 * Un `external_id` identifica la intención de pago, no una entrega concreta: las
 * pasarelas mandan varios eventos sobre el mismo id a medida que la operación
 * avanza, y no garantizan el orden.
 *
 * Vive acá y no en el webhook porque es una regla del negocio: quién puede pasar
 * a qué estado no depende de cómo llegó la novedad.
 */
export function puedeAvanzarEstadoPago(actual: EstadoPago, entrante: EstadoPago): boolean {
  if (actual === entrante) return false
  return TRANSICIONES[actual].includes(entrante)
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Consolida los pagos aprobados de una reserva contra su total. */
export function resumenPagos(total: number, pagos: Pago[]): ResumenPagos {
  let pagado = 0
  let tieneSenia = false
  for (const p of pagos) {
    if (p.estado !== 'aprobado') continue
    if (p.tipo === 'reembolso') {
      pagado -= p.monto
    } else {
      pagado += p.monto
      if (p.tipo === 'senia') tieneSenia = true
    }
  }
  pagado = redondear(pagado)
  const saldo = redondear(Math.max(0, total - pagado))
  return {
    pagado,
    saldo,
    saldada: total > 0 && pagado >= total - 0.001,
    tieneSenia,
  }
}

/** Seña sugerida = primera noche (aprox. total / noches). */
export function seniaSugerida(total: number, noches: number): number {
  return redondear(noches > 0 ? total / noches : total)
}

/* ──────────────────────────────── el estado que corresponde a lo cobrado ──── */

/**
 * A qué estado tiene que ir la reserva según lo que se cobró. `null` = no tocar.
 *
 * Es la regla del Tarifario, escrita una sola vez:
 *
 * · **La seña confirma la reserva.** «La reserva se bloquea con el pago de la
 *   seña». Una reserva `pendiente` con seña cobrada tiene que pasar a
 *   `confirmada` o la expiración la libera a los 5 días —y el hotel revende la
 *   unidad con la plata del huésped ya cobrada—. Es el caso que aparece recién
 *   cuando el portal público puede cobrar de verdad.
 * · **La cuenta cubierta la pasa a `pagada`.**
 *
 * Sólo opina sobre reservas que todavía están en la etapa comercial. Una
 * `in_house` que termina de pagar no vuelve a `pagada`: ya está alojada, y ése
 * es el dato que le importa a recepción. Una `cancelada` o `no_show` no se
 * mueve por un cobro: qué hacer con esa plata es una decisión del hotel.
 */
export function estadoSegunPagos(
  actual: string,
  resumen: Pick<ResumenPagos, 'saldada' | 'tieneSenia'>,
): 'confirmada' | 'pagada' | null {
  if (actual !== 'pendiente' && actual !== 'confirmada') return null
  if (resumen.saldada) return 'pagada'
  if (resumen.tieneSenia && actual === 'pendiente') return 'confirmada'
  return null
}
