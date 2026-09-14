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

import {
  inicioFinDeMes,
  inicioFinDeSemana,
  sumarDias,
  diasEntre,
  nochesEnVentana,
  parsearPeriodo,
} from '@/lib/fechas'

/** Lo mínimo que se necesita de una estadía para calcular las métricas. */
export interface EstadiaMetrica {
  periodo: string
  precio_noche: number | string | null
}

export interface MetricasPeriodo {
  /** Primer día de la ventana, inclusive. */
  inicio: string
  /** Último día de la ventana, EXCLUSIVE (mismo criterio `[inicio, fin)` que el resto del sistema). */
  fin: string
  /** Noches efectivamente ocupadas dentro de la ventana. */
  nochesVendidas: number
  /** Noches que el hotel podía vender (unidades × días de la ventana). */
  nochesDisponibles: number
  /** Ingreso de alojamiento imputado a la ventana. */
  ingreso: number
  ocupacionPct: number
  adr: number
  revpar: number
}

export interface MetricasMes extends MetricasPeriodo {
  /** Mes en formato `YYYY-MM`. */
  mes: string
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
 * Calcula las métricas de una ventana `[inicio, fin)` cualquiera — un mes, una
 * semana, cualquier rango. Es el cálculo real; `metricasDeMes` es el caso
 * particular «la ventana es un mes calendario».
 *
 * Las estadías se prorratean: una reserva a caballo del borde de la ventana
 * aporta solo las noches que le corresponden.
 */
export function metricasDePeriodo(
  estadias: readonly EstadiaMetrica[],
  ventana: { inicio: string; fin: string },
  cantidadUnidades: number,
): MetricasPeriodo {
  const { inicio, fin } = ventana
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
    inicio,
    fin,
    nochesVendidas,
    nochesDisponibles,
    ingreso,
    ocupacionPct: nochesDisponibles ? Math.round((nochesVendidas / nochesDisponibles) * 100) : 0,
    adr: nochesVendidas ? Math.round(ingreso / nochesVendidas) : 0,
    revpar: nochesDisponibles ? Math.round(ingreso / nochesDisponibles) : 0,
  }
}

/** Calcula las métricas de un mes calendario `YYYY-MM`. */
export function metricasDeMes(
  estadias: readonly EstadiaMetrica[],
  mes: string,
  cantidadUnidades: number,
): MetricasMes {
  return { mes, ...metricasDePeriodo(estadias, inicioFinDeMes(mes), cantidadUnidades) }
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

/* ─────────────────────────────────────────────── vista semanal (Fase de pedidos 2026-09-14) ── */

/**
 * Desplaza una semana en `delta` semanas. Una semana se identifica por el ISO
 * del lunes correspondiente (ver `inicioFinDeSemana` en `lib/fechas.ts`), así
 * que desplazarla es sumar `delta * 7` días — sin casos borde de año como
 * tendría la numeración de semana ISO.
 */
export function semanaRelativa(semana: string, delta: number): string {
  return sumarDias(semana, delta * 7)
}

/** Las últimas `cantidad` semanas terminando en `semana` (de la más vieja a la más nueva). */
export function ultimasSemanas(semana: string, cantidad: number): string[] {
  const semanas: string[] = []
  for (let i = cantidad - 1; i >= 0; i--) semanas.push(semanaRelativa(semana, -i))
  return semanas
}

/** Calcula las métricas de la semana (lunes a domingo) que empieza en `semana`. */
export function metricasDeSemana(
  estadias: readonly EstadiaMetrica[],
  semana: string,
  cantidadUnidades: number,
): MetricasPeriodo & { semana: string } {
  return { semana, ...metricasDePeriodo(estadias, inicioFinDeSemana(semana), cantidadUnidades) }
}

/** Rango corto para los ejes del gráfico semanal (ej: `8-14 sep`). */
export function etiquetaSemana(semana: string): string {
  const nombres = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const domingo = sumarDias(semana, 6)
  const [, mIni, dIni] = semana.split('-').map(Number)
  const [, mFin, dFin] = domingo.split('-').map(Number)
  if (mIni === mFin) return `${dIni}-${dFin} ${nombres[mFin - 1]}`
  return `${dIni} ${nombres[mIni - 1]} - ${dFin} ${nombres[mFin - 1]}`
}
