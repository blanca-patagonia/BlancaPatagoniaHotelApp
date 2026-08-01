/**
 * Métricas hoteleras por mes (lógica pura).
 *
 * Concentra el cálculo de ocupación, ADR y RevPAR para que la pantalla de
 * reportes y la exportación a CSV usen exactamente la misma cuenta, y para
 * poder verificarla con tests sin depender de la base.
 *
 * Definiciones estándar de la industria:
 * · Ocupación = noches vendidas / noches disponibles
 * · ADR    (Average Daily Rate)          = ingreso de alojamiento / noches vendidas
 * · RevPAR (Revenue per Available Room)  = ingreso de alojamiento / noches disponibles
 */

import { inicioFinDeMes, diasEntre, nochesEnVentana, parsearPeriodo } from '@/lib/fechas'

/** Lo mínimo que se necesita de una estadía para calcular las métricas. */
export interface EstadiaMetrica {
  periodo: string
  precio_noche: number | string | null
}

export interface MetricasMes {
  /** Mes en formato `YYYY-MM`. */
  mes: string
  /** Noches efectivamente ocupadas dentro del mes. */
  nochesVendidas: number
  /** Noches que el hotel podía vender (unidades × días del mes). */
  nochesDisponibles: number
  /** Ingreso de alojamiento imputado al mes. */
  ingreso: number
  ocupacionPct: number
  adr: number
  revpar: number
}

/**
 * Desplaza un mes `YYYY-MM` en `delta` meses (delta negativo va hacia atrás).
 */
export function mesRelativo(mes: string, delta: number): string {
  const [anio, m] = mes.split('-').map(Number)
  // `Date.UTC` normaliza solo: el mes 0 es diciembre del año anterior.
  const d = new Date(Date.UTC(anio, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Los últimos `cantidad` meses terminando en `mes` (del más viejo al más nuevo). */
export function ultimosMeses(mes: string, cantidad: number): string[] {
  const meses: string[] = []
  for (let i = cantidad - 1; i >= 0; i--) meses.push(mesRelativo(mes, -i))
  return meses
}

/**
 * Calcula las métricas de un mes.
 *
 * Las estadías se prorratean: una reserva a caballo entre dos meses aporta a
 * cada uno solo las noches que le corresponden.
 */
export function metricasDeMes(
  estadias: readonly EstadiaMetrica[],
  mes: string,
  cantidadUnidades: number,
): MetricasMes {
  const { inicio, fin } = inicioFinDeMes(mes)
  const nochesDisponibles = cantidadUnidades * diasEntre(inicio, fin)

  let nochesVendidas = 0
  let ingreso = 0
  for (const e of estadias) {
    const noches = nochesEnVentana(parsearPeriodo(e.periodo), inicio, fin)
    if (noches <= 0) continue
    nochesVendidas += noches
    ingreso += noches * Number(e.precio_noche ?? 0)
  }

  return {
    mes,
    nochesVendidas,
    nochesDisponibles,
    ingreso,
    ocupacionPct: nochesDisponibles ? Math.round((nochesVendidas / nochesDisponibles) * 100) : 0,
    adr: nochesVendidas ? Math.round(ingreso / nochesVendidas) : 0,
    revpar: nochesDisponibles ? Math.round(ingreso / nochesDisponibles) : 0,
  }
}

/**
 * Variación porcentual entre dos valores, redondeada.
 *
 * Devuelve `null` cuando no hay base de comparación (el mes anterior fue cero),
 * porque un «+100 %» sobre cero sería engañoso en un informe de gestión.
 */
export function variacionPct(actual: number, anterior: number): number | null {
  if (anterior === 0) return null
  return Math.round(((actual - anterior) / anterior) * 100)
}

/** Nombre corto del mes para los ejes de los gráficos (ej: `ene 26`). */
export function etiquetaMes(mes: string): string {
  const [anio, m] = mes.split('-')
  const nombres = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${nombres[Number(m) - 1]} ${anio.slice(2)}`
}
