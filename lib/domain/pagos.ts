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
