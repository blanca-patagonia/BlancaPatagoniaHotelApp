/**
 * Utilidades de fecha en formato ISO `yyyy-mm-dd`, sin dependencias externas.
 *
 * Las operaciones de calendario (`sumarDias`, `diasEntre`, `listaDias`…) anclan en
 * UTC **a propósito**: reciben y devuelven días, no instantes, así que la zona no
 * interviene. `sumarDias('2026-08-30', 1)` es el 31 en cualquier parte del mundo.
 *
 * La que sí depende de la zona es `hoyISO()`, porque es la única que lee el reloj.
 */

/**
 * Zona horaria del hotel (El Calafate, Santa Cruz). UTC−3 todo el año: la
 * Argentina no aplica horario de verano desde 2009.
 */
export const ZONA_HOTEL = 'America/Argentina/Rio_Gallegos'

/**
 * El día de hoy **en el hotel**, no en el servidor.
 *
 * ⚠️ Esto era `new Date().toISOString().slice(0, 10)`, que da el día en **UTC**.
 * Vercel corre en UTC y el hotel está en UTC−3, así que entre las 21:00 y la
 * medianoche de El Calafate el sistema entero operaba con la fecha del día
 * siguiente: housekeeping mostraba las salidas de mañana, el punto de venta
 * cargaba el consumo de las 21:30 a la noche equivocada, y el feed iCal publicaba
 * como libre una noche vendida. Tres horas por día, todos los días.
 *
 * No se nota programando —de día las dos fechas coinciden— ni en los tests, que
 * corren en UTC y comparaban UTC contra UTC. Por eso `tests/fechas.test.ts` fija
 * la zona del proceso a una lejana y exige que el resultado siga siendo el del
 * hotel.
 *
 * `formatToParts` y no `toLocaleDateString('en-CA')`: el formato de un locale es
 * dato de ICU y puede cambiar entre versiones de Node. Las partes, no.
 */
export function hoyISO(fecha: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HOTEL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha)

  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)!.value

  return `${parte('year')}-${parte('month')}-${parte('day')}`
}

export interface Periodo {
  desde: string
  hasta: string
}

export function sumarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(desdeISO: string, hastaISO: string): number {
  const a = Date.parse(desdeISO + 'T00:00:00Z')
  const b = Date.parse(hastaISO + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

/** Lista de `cantidad` días consecutivos a partir de `desde` (inclusive). */
export function listaDias(desde: string, cantidad: number): string[] {
  return Array.from({ length: cantidad }, (_, i) => sumarDias(desde, i))
}

/** Parsea un `daterange` de Postgres, p. ej. `[2026-07-27,2026-07-30)`. */
export function parsearPeriodo(rango: string): Periodo {
  const m = rango.match(
    /[[(]\s*"?(\d{4}-\d{2}-\d{2})"?\s*,\s*"?(\d{4}-\d{2}-\d{2})"?\s*[\])]/,
  )
  if (!m) throw new Error(`Rango de fecha inválido: ${rango}`)
  return { desde: m[1], hasta: m[2] }
}

export function rangoISO(desde: string, hasta: string): string {
  return `[${desde},${hasta})`
}

export function formatoFechaCorta(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** ¿La fecha `dia` cae dentro del período `[desde, hasta)`? */
export function contieneDia(p: Periodo, dia: string): boolean {
  return dia >= p.desde && dia < p.hasta
}

/**
 * Noches del período `p` que caen dentro de la ventana `[ventanaDesde, ventanaHasta)`.
 * Útil para prorratear la ocupación de una estadía a un mes.
 */
export function nochesEnVentana(p: Periodo, ventanaDesde: string, ventanaHasta: string): number {
  const desde = p.desde > ventanaDesde ? p.desde : ventanaDesde
  const hasta = p.hasta < ventanaHasta ? p.hasta : ventanaHasta
  const n = diasEntre(desde, hasta)
  return n > 0 ? n : 0
}

/** Primer y (exclusivo) último día de un mes `YYYY-MM`. */
export function inicioFinDeMes(mes: string): { inicio: string; fin: string } {
  const [y, m] = mes.split('-').map(Number)
  const inicio = `${mes}-01`
  const finAnio = m === 12 ? y + 1 : y
  const finMes = m === 12 ? 1 : m + 1
  const fin = `${finAnio}-${String(finMes).padStart(2, '0')}-01`
  return { inicio, fin }
}

/** Mes actual en formato `YYYY-MM`. */
export function mesActual(): string {
  return hoyISO().slice(0, 7)
}
