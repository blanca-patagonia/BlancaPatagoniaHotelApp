/**
 * Reporte de antigüedad de saldos (*aging report*) — lógica pura.
 *
 * Clasifica la deuda con proveedores según hace cuánto venció cada comprobante.
 * Es el informe estándar de cuentas por pagar: no es lo mismo deber $100.000
 * que vencen la semana que viene que deberlos desde hace tres meses.
 *
 * Debe mantenerse en sincronía con el enum `estado_comprobante`
 * (ver `supabase/migrations/0022_comercial_y_conciliacion.sql`).
 */

import { diasEntre } from '@/lib/fechas'

export const ESTADOS_COMPROBANTE = ['pendiente', 'pagado', 'vencido', 'anulado'] as const
export type EstadoComprobante = (typeof ESTADOS_COMPROBANTE)[number]

export const ETIQUETAS_ESTADO_COMPROBANTE: Record<EstadoComprobante, string> = {
  pendiente: 'Pendiente',
  pagado: 'Pagado',
  vencido: 'Vencido',
  anulado: 'Anulado',
}

/** Tramos del reporte, del más sano al más preocupante. */
export const TRAMOS = ['corriente', 'd1_30', 'd31_60', 'd61_90', 'd90_mas'] as const
export type Tramo = (typeof TRAMOS)[number]

export const ETIQUETAS_TRAMO: Record<Tramo, string> = {
  corriente: 'Por vencer',
  d1_30: '1 a 30 días',
  d31_60: '31 a 60 días',
  d61_90: '61 a 90 días',
  d90_mas: 'Más de 90 días',
}

/**
 * Ubica un comprobante en su tramo según los días transcurridos desde el
 * vencimiento.
 *
 * Un comprobante sin fecha de vencimiento se considera corriente: no se puede
 * afirmar que esté atrasado.
 */
export function clasificarTramo(vencimiento: string | null | undefined, hoy: string): Tramo {
  if (!vencimiento) return 'corriente'
  const dias = diasEntre(vencimiento, hoy)
  if (dias <= 0) return 'corriente'
  if (dias <= 30) return 'd1_30'
  if (dias <= 60) return 'd31_60'
  if (dias <= 90) return 'd61_90'
  return 'd90_mas'
}

/** Comprobante mínimo que necesita el reporte. */
export interface ComprobanteDeuda {
  tipo: 'cargo' | 'pago'
  estado: EstadoComprobante
  monto: number | string
  vencimiento?: string | null
}

/**
 * Un comprobante suma a la deuda si es un cargo (factura del proveedor) que
 * todavía no se pagó ni se anuló.
 */
export function esDeudaViva(c: ComprobanteDeuda): boolean {
  return c.tipo === 'cargo' && (c.estado === 'pendiente' || c.estado === 'vencido')
}

export type ResumenAntiguedad = Record<Tramo, number>

/** Suma la deuda viva por tramo de antigüedad. */
export function resumenAntiguedad(
  comprobantes: readonly ComprobanteDeuda[],
  hoy: string,
): ResumenAntiguedad {
  const resumen = Object.fromEntries(TRAMOS.map((t) => [t, 0])) as ResumenAntiguedad

  for (const c of comprobantes) {
    if (!esDeudaViva(c)) continue
    resumen[clasificarTramo(c.vencimiento, hoy)] += Number(c.monto)
  }
  // Redondeo final por tramo, para no arrastrar centavos de coma flotante.
  for (const t of TRAMOS) resumen[t] = Math.round(resumen[t] * 100) / 100
  return resumen
}

/** Total adeudado, sumando todos los tramos. */
export function totalAdeudado(resumen: ResumenAntiguedad): number {
  return Math.round(TRAMOS.reduce((acc, t) => acc + resumen[t], 0) * 100) / 100
}

/**
 * Deuda vencida (todo lo que no es corriente). Es el número que mira gerencia:
 * mide el atraso real, no el compromiso futuro.
 */
export function totalVencido(resumen: ResumenAntiguedad): number {
  const vencidos = TRAMOS.filter((t) => t !== 'corriente')
  return Math.round(vencidos.reduce((acc, t) => acc + resumen[t], 0) * 100) / 100
}

/** Comprobantes que vencen dentro de los próximos `dias` (recordatorio de pago). */
export function porVencer<T extends { vencimiento?: string | null }>(
  comprobantes: readonly T[],
  hoy: string,
  dias = 7,
): T[] {
  return comprobantes.filter((c) => {
    if (!c.vencimiento) return false
    const faltan = diasEntre(hoy, c.vencimiento)
    return faltan >= 0 && faltan <= dias
  })
}
