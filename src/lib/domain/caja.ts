/**
 * Flujo de caja del hotel (lógica pura): cuánta plata entró, por día y por mes.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * El tablero de Inicio mostraba la operación del día —llegadas, salidas,
 * unidades— y nada de plata. Al probar la demo, el docente lo dijo así: «si yo
 * soy el administrador, me interesa ver cómo está el hotel, cuánta plata estoy
 * ganando, cuánta gente no me paga, el flujo de caja, el diario y el mensual».
 * Los informes ya lo sabían; el Inicio, no.
 *
 * ── Qué cuenta como caja ────────────────────────────────────────────────────
 *
 * Los pagos **aprobados**, con la misma regla que `resumenPagos`: seña y saldo
 * suman, un reembolso resta. Un pago que pasó de aprobado a `reembolsado` deja
 * de contar (la plata volvió). El día es el del HOTEL (`fechaDelHotel`), no el
 * de UTC: un cobro de las 22:00 cae en su noche, no en la mañana siguiente.
 *
 * ⚠️ `pagos.monto` está SIEMPRE en USD (ADR 0027), aunque el huésped haya pagado
 * en pesos: la caja se expresa en dólares, igual que el resto del sistema.
 */

import { fechaDelHotel, sumarDias } from '@/lib/fechas'
import type { EstadoPago, TipoPago } from './pagos'

export interface MovimientoCaja {
  tipo: TipoPago
  monto: number | string
  estado: EstadoPago
  /** `timestamptz` del pago. */
  creado_en: string
}

export interface CajaDelPeriodo {
  /** Seña + saldo aprobados. */
  ingresos: number
  /** Reembolsos aprobados (en positivo). */
  reembolsos: number
  /** Ingresos menos reembolsos. */
  neto: number
  /** Cuántos cobros (no reembolsos) entraron. */
  cobros: number
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Caja de la ventana `[inicio, fin)`, en días del hotel. */
export function cajaEnPeriodo(
  movimientos: readonly MovimientoCaja[],
  ventana: { inicio: string; fin: string },
): CajaDelPeriodo {
  let ingresos = 0
  let reembolsos = 0
  let cobros = 0
  for (const m of movimientos) {
    if (m.estado !== 'aprobado') continue
    const dia = fechaDelHotel(m.creado_en)
    if (dia < ventana.inicio || dia >= ventana.fin) continue
    if (m.tipo === 'reembolso') {
      reembolsos += Number(m.monto)
    } else {
      ingresos += Number(m.monto)
      cobros++
    }
  }
  return {
    ingresos: redondear(ingresos),
    reembolsos: redondear(reembolsos),
    neto: redondear(ingresos - reembolsos),
    cobros,
  }
}

/** Caja neta de cada día de la lista (para el gráfico diario). */
export function cajaPorDia(
  movimientos: readonly MovimientoCaja[],
  dias: readonly string[],
): { dia: string; neto: number }[] {
  return dias.map((dia) => ({ dia, neto: cajaEnPeriodo(movimientos, { inicio: dia, fin: sumarDias(dia, 1) }).neto }))
}

/** Los días del mes de `hoy`, del 1 hasta `hoy` inclusive. */
export function diasDelMesHasta(hoy: string): string[] {
  const dias: string[] = []
  for (let d = `${hoy.slice(0, 7)}-01`; d <= hoy; d = sumarDias(d, 1)) dias.push(d)
  return dias
}

/**
 * El mismo tramo del mes anterior: del 1 al mismo día (inclusive).
 *
 * Comparar lo cobrado en el mes en curso contra el mes anterior COMPLETO hace
 * que todos los meses parezcan peores hasta el último día. La comparación
 * honesta es «del 1 al 22 de este mes contra del 1 al 22 del anterior». Si el
 * mes anterior es más corto (31 de marzo contra febrero), se toma hasta su
 * último día.
 *
 * Devuelve la ventana `[inicio, fin)`.
 */
export function mismoTramoDelMesAnterior(hoy: string): { inicio: string; fin: string } {
  const [y, m, d] = hoy.split('-').map(Number)
  const anioAnt = m === 1 ? y - 1 : y
  const mesAnt = m === 1 ? 12 : m - 1
  const inicio = `${anioAnt}-${String(mesAnt).padStart(2, '0')}-01`
  const ultimoDia = new Date(Date.UTC(anioAnt, mesAnt, 0)).getUTCDate()
  const dia = Math.min(d, ultimoDia)
  const fin = sumarDias(`${anioAnt}-${String(mesAnt).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, 1)
  return { inicio, fin }
}

/** Una reserva que debe plata, para la lista «quién debe» del tablero. */
export interface Deudor {
  id: string
  codigo: string
  huesped: string
  saldo: number
}

/** Los que más deben primero; a igual saldo, por código (orden estable). */
export function ordenarDeudores(deudores: readonly Deudor[]): Deudor[] {
  return [...deudores].sort((a, b) => b.saldo - a.saldo || a.codigo.localeCompare(b.codigo))
}
