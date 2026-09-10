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

/**
 * Formatea un **instante** (`timestamptz`) para mostrarlo, siempre en la hora del
 * hotel.
 *
 * ── El mismo error que arregló `hoyISO`, del otro lado ──────────────────────
 *
 * `hoyISO` corrigió la fecha con la que el sistema **opera**. Esto corrige la
 * que el sistema **muestra**. Eran catorce pantallas escribiendo
 * `new Date(iso).toLocaleDateString('es-AR')`, que no lleva zona: usa la del
 * proceso. En Vercel el proceso corre en UTC y el hotel está en UTC−3, así que
 * todo lo ocurrido entre las 21:00 y la medianoche de El Calafate se mostraba
 * **con la fecha del día siguiente**, y toda hora, tres horas adelantada.
 *
 * No es un detalle cosmético en las pantallas donde aparecía: la fecha de firma
 * de un contrato, la de emisión de una nota de crédito y el registro de
 * auditoría son, las tres, constancias de cuándo pasó algo.
 *
 * Había además una inconsistencia visible: `conversaciones/page.tsx` pinta la
 * lista en el servidor (UTC) y `chat.tsx` es un componente de cliente, que usaba
 * la zona del navegador (la del hotel). El mismo mensaje mostraba dos horas
 * distintas según qué lo dibujara. Fijar la zona hace que coincidan.
 *
 * `es-AR` da `dd/mm/aaaa`, que es como se escribe una fecha en la Argentina.
 */
export function fechaHotel(iso: string | Date, opciones?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: ZONA_HOTEL, ...opciones })
}

/**
 * Reloj de 24 horas, que es como se dice la hora en la Argentina.
 *
 * ── Por qué se fija en vez de dejar el default del locale ───────────────────
 *
 * El ICU de Node formatea `es-AR` en 12 horas, y ahí aparece un problema peor
 * que el de la zona: `toLocaleString('es-AR')` devuelve `«30/8/2026, 09:30:00»`
 * **sin ningún indicador de a. m. / p. m.**. Esa hora es ambigua: 09:30 de la
 * mañana y 21:30 de la noche se escriben igual.
 *
 * Donde se muestra —auditoría, registro de errores, respaldos, conversaciones—
 * la hora es el dato. Un registro de auditoría en el que no se puede distinguir
 * la mañana de la noche no sirve para lo que existe. Con `h23` se lee `21:30`,
 * que además es lo que espera cualquiera acá.
 */
const RELOJ_24: Intl.DateTimeFormatOptions = { hourCycle: 'h23' }

/** Fecha y hora de un instante, en la hora del hotel. */
export function fechaHoraHotel(iso: string | Date): string {
  return new Date(iso).toLocaleString('es-AR', { timeZone: ZONA_HOTEL, ...RELOJ_24 })
}

/** Solo la hora de un instante, en la hora del hotel. */
export function horaHotel(iso: string | Date, opciones?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    timeZone: ZONA_HOTEL,
    ...RELOJ_24,
    ...opciones,
  })
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

/**
 * `DD/MM/AAAA` de una fecha (columna `date`, sin hora), con el año.
 *
 * Por texto, no por `Date` — mismo motivo que `formatoFechaCorta`. Una
 * columna `date` de Postgres llega como `"2026-09-09"`, sin hora. Pasarla por
 * `fechaHotel` (que arma `new Date(iso)`) la interpreta como medianoche UTC, y
 * en `America/Argentina/Rio_Gallegos` (UTC-3) eso cae en el día ANTERIOR: un
 * gasto cargado el 9 se mostraba como del 8. `formatoFechaCorta` ya evitaba
 * esto para `DD/MM`; esta es la misma idea para cuando además hace falta el
 * año (un listado que puede acumular más de un año de filas).
 */
export function formatoFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
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
