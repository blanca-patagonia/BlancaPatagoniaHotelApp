/**
 * Cuentas corrientes de agencias / empresas (lógica pura).
 * Saldo = cargos − pagos. Positivo → la agencia adeuda al hotel.
 */

export const TIPOS_CUENTA = ['agencia', 'empresa'] as const
export type TipoCuenta = (typeof TIPOS_CUENTA)[number]

export const ETIQUETAS_TIPO_CUENTA: Record<TipoCuenta, string> = {
  agencia: 'Agencia',
  empresa: 'Empresa',
}

export type TipoMovimiento = 'cargo' | 'pago'

export const ETIQUETAS_MOVIMIENTO: Record<TipoMovimiento, string> = {
  cargo: 'Cargo',
  pago: 'Pago',
}

export interface Movimiento {
  tipo: TipoMovimiento
  monto: number
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Saldo de la cuenta corriente (cargos − pagos). */
export function saldoCuenta(movimientos: Movimiento[]): number {
  return redondear(
    movimientos.reduce((acc, m) => acc + (m.tipo === 'cargo' ? m.monto : -m.monto), 0),
  )
}

/** Aplica el descuento de agencia a un importe. */
export function aplicarDescuento(monto: number, descuentoPct: number): number {
  return redondear(monto * (1 - descuentoPct / 100))
}
