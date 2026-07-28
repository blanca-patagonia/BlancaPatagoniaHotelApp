/**
 * Utilidades de fecha en formato ISO `yyyy-mm-dd`, sin dependencias externas.
 * Nota: se trabaja en UTC por simplicidad; el ajuste fino de zona horaria
 * (America/Argentina/Rio_Gallegos) se aborda en una fase posterior.
 */

export interface Periodo {
  desde: string
  hasta: string
}

export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
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
