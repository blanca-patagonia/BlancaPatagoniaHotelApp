/**
 * Mantenimiento preventivo (lógica pura).
 *
 * `ordenes_mantenimiento` es reactivo: alguien reporta una avería y se crea la
 * orden. Esto modela lo planificado — revisar la calefacción cada 6 meses,
 * limpiar los tanques cada 12 — que es lo que evita la avería.
 *
 * El cálculo vive acá y no solo en la función SQL para poder testearlo y para
 * que la pantalla pueda anticipar qué se va a generar.
 */

import { diasEntre, sumarDias } from '@/lib/fechas'

/** Periodicidades habituales, para ofrecerlas en el formulario. */
export const PERIODICIDADES = [
  { meses: 1, etiqueta: 'Todos los meses' },
  { meses: 3, etiqueta: 'Cada 3 meses' },
  { meses: 6, etiqueta: 'Cada 6 meses' },
  { meses: 12, etiqueta: 'Una vez al año' },
  { meses: 24, etiqueta: 'Cada 2 años' },
] as const

export const MIN_MESES = 1
export const MAX_MESES = 60

export function periodicidadValida(meses: number): boolean {
  return Number.isInteger(meses) && meses >= MIN_MESES && meses <= MAX_MESES
}

/**
 * Suma meses a una fecha ISO manteniendo el día.
 *
 * Si el día no existe en el mes destino (31 de enero + 1 mes), cae en el último
 * día de ese mes en lugar de saltar al mes siguiente, que es lo que espera
 * cualquiera al programar una tarea «el 31 de cada mes».
 */
export function sumarMeses(fechaISO: string, meses: number): string {
  const [anio, mes, dia] = fechaISO.split('-').map(Number)
  const destino = new Date(Date.UTC(anio, mes - 1 + meses, 1))
  const ultimoDiaDelMes = new Date(
    Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0),
  ).getUTCDate()
  destino.setUTCDate(Math.min(dia, ultimoDiaDelMes))
  return destino.toISOString().slice(0, 10)
}

/** Próxima ejecución a partir de la última (o del alta, si nunca se ejecutó). */
export function proximaEjecucion(desde: string, cadaMeses: number): string {
  return sumarMeses(desde, cadaMeses)
}

/** Un plan está vencido cuando su próxima ejecución ya pasó. */
export function planVencido(proximaEjecucion: string, hoy: string): boolean {
  return proximaEjecucion <= hoy
}

/** Días que faltan para la próxima ejecución (negativo si ya venció). */
export function diasParaProxima(proximaEjecucion: string, hoy: string): number {
  return diasEntre(hoy, proximaEjecucion)
}

/** Un plan es inminente si vence dentro de la ventana indicada. */
export function esInminente(proximaEjecucion: string, hoy: string, ventanaDias = 15): boolean {
  const faltan = diasParaProxima(proximaEjecucion, hoy)
  return faltan >= 0 && faltan <= ventanaDias
}

export interface PlanPreventivo {
  proxima_ejecucion: string
  activo: boolean
}

/** Planes que hay que ejecutar hoy: son los que generarán una orden. */
export function planesAEjecutar<T extends PlanPreventivo>(planes: readonly T[], hoy: string): T[] {
  return planes.filter((p) => p.activo && planVencido(p.proxima_ejecucion, hoy))
}

/**
 * Fecha sugerida para la primera ejecución de un plan nuevo.
 *
 * Se propone dentro de una semana y no hoy mismo, para no llenar de órdenes el
 * tablero apenas se carga el plan.
 */
export function primeraEjecucionSugerida(hoy: string): string {
  return sumarDias(hoy, 7)
}
