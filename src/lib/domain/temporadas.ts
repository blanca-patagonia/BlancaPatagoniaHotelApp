/**
 * Calendario de temporadas (lógica pura).
 *
 * Una fecha pertenece a una temporada y de ahí sale la tarifa. Si ninguna
 * temporada la cubre, **no hay precio posible**: la reserva no se puede cotizar.
 *
 * Este módulo existe por un problema real. Los rangos cargados llegaban hasta
 * junio de 2026 y el hotel siguió operando: al reservar para agosto, el sistema
 * mostraba «USD 0» y recién al confirmar avisaba que faltaba la tarifa. El
 * tarifario estaba completo —los diez tipos con sus precios—, lo que faltaba
 * era decirle al sistema **a qué fechas** aplicaba cada temporada.
 *
 * Lo importante entonces no es sólo poder cargar rangos, sino **ver los huecos
 * antes de que un huésped se choque con ellos**. Eso hace `huecosDeCobertura`.
 *
 * La garantía de que dos temporadas no se pisen NO está acá: la impone una
 * restricción de exclusión GiST sobre `temporada_rangos`, igual que el
 * anti-overbooking (ADR 0002).
 */

import { diasEntre, sumarDias } from '../fechas'

/** Rango de fechas de una temporada, con el fin **excluido** (`[desde, hasta)`). */
export interface RangoTemporada {
  desde: string
  hasta: string
}

export interface Hueco {
  desde: string
  hasta: string
  dias: number
}

/**
 * Convierte el `daterange` de Postgres (`[2026-01-01,2026-03-01)`) a fechas.
 *
 * Se hace acá y no en cada pantalla porque el formato es una particularidad de
 * la base que no tiene por qué filtrarse a la interfaz.
 */
export function parsearRango(rango: string): RangoTemporada {
  const limpio = rango.replace(/[[\]()]/g, '')
  const [desde, hasta] = limpio.split(',')
  return { desde: desde.trim(), hasta: hasta.trim() }
}

/** Arma el literal que espera Postgres. El fin siempre queda excluido. */
export function formatearRango(desde: string, hasta: string): string {
  return `[${desde},${hasta})`
}

/** ¿El rango es válido para guardar? */
export function rangoInvalido(desde: string, hasta: string): string | null {
  if (!desde || !hasta) return 'Indicá la fecha de inicio y la de fin.'
  if (hasta <= desde) return 'La fecha de fin tiene que ser posterior a la de inicio.'
  return null
}

/**
 * Días que cubre un rango. El fin está excluido: del 1 al 8 son 7 noches.
 */
export function diasDelRango(r: RangoTemporada): number {
  return diasEntre(r.desde, r.hasta)
}

/**
 * Tramos SIN temporada asignada entre `desde` y `hasta`.
 *
 * Es la función que da sentido al módulo: responde «¿desde cuándo el sistema no
 * va a poder cotizar?» antes de que lo descubra un huésped. Los rangos pueden
 * venir en cualquier orden y se los ordena acá.
 */
export function huecosDeCobertura(
  rangos: readonly RangoTemporada[],
  desde: string,
  hasta: string,
): Hueco[] {
  if (hasta <= desde) return []

  const ordenados = [...rangos]
    .filter((r) => r.hasta > desde && r.desde < hasta)
    .sort((a, b) => a.desde.localeCompare(b.desde))

  const huecos: Hueco[] = []
  let cursor = desde

  for (const r of ordenados) {
    if (r.desde > cursor) {
      huecos.push({ desde: cursor, hasta: r.desde, dias: diasEntre(cursor, r.desde) })
    }
    // Los rangos pueden estar contenidos en otros ya recorridos: se avanza al
    // más lejano, nunca hacia atrás.
    if (r.hasta > cursor) cursor = r.hasta
  }

  if (cursor < hasta) {
    huecos.push({ desde: cursor, hasta, dias: diasEntre(cursor, hasta) })
  }

  return huecos
}

/** ¿Esa fecha tiene temporada asignada? */
export function tieneCobertura(rangos: readonly RangoTemporada[], fecha: string): boolean {
  return rangos.some((r) => r.desde <= fecha && fecha < r.hasta)
}

/**
 * Última fecha cubierta de forma continua desde `desde`.
 *
 * Sirve para el aviso «podés vender hasta el …»: es el dato que le importa a
 * quien vende, más que la lista de rangos.
 */
export function cubiertoHasta(
  rangos: readonly RangoTemporada[],
  desde: string,
): string | null {
  if (!tieneCobertura(rangos, desde)) return null

  const ordenados = [...rangos].sort((a, b) => a.desde.localeCompare(b.desde))
  let fin = desde
  for (const r of ordenados) {
    if (r.desde <= fin && r.hasta > fin) fin = r.hasta
  }
  // El fin del rango está excluido: el último día vendible es el anterior.
  return sumarDias(fin, -1)
}
