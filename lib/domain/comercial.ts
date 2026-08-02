/**
 * Pipeline comercial de agencias y cuentas corporativas (lógica pura).
 *
 * Hasta ahora «Agencias» solo llevaba cuentas por cobrar: la cuenta existía o no
 * existía. Esto modela el trabajo previo — el convenio de tarifas netas se
 * negocia — para que gerencia vea en qué estado está cada oportunidad.
 *
 * Debe mantenerse en sincronía con el enum `etapa_comercial` de la base
 * (ver `supabase/migrations/0022_comercial_y_conciliacion.sql`).
 */

export const ETAPAS_COMERCIALES = [
  'contacto',
  'cotizacion_enviada',
  'convenio_firmado',
  'activa',
  'perdida',
] as const

export type EtapaComercial = (typeof ETAPAS_COMERCIALES)[number]

export const ETIQUETAS_ETAPA: Record<EtapaComercial, string> = {
  contacto: 'Primer contacto',
  cotizacion_enviada: 'Cotización enviada',
  convenio_firmado: 'Convenio firmado',
  activa: 'Activa',
  perdida: 'Perdida',
}

/** Etapas del embudo, en orden. `perdida` queda fuera: es una salida lateral. */
export const EMBUDO: readonly EtapaComercial[] = [
  'contacto',
  'cotizacion_enviada',
  'convenio_firmado',
  'activa',
]

/**
 * Transiciones válidas.
 *
 * Desde cualquier etapa del embudo se puede dar la oportunidad por perdida, y
 * una perdida se puede reabrir volviendo al contacto inicial.
 */
export const TRANSICIONES_ETAPA: Record<EtapaComercial, readonly EtapaComercial[]> = {
  contacto: ['cotizacion_enviada', 'perdida'],
  cotizacion_enviada: ['convenio_firmado', 'perdida'],
  convenio_firmado: ['activa', 'perdida'],
  activa: ['perdida'],
  perdida: ['contacto'],
}

export function etapasPosibles(etapa: EtapaComercial): readonly EtapaComercial[] {
  return TRANSICIONES_ETAPA[etapa]
}

export function puedeAvanzar(desde: EtapaComercial, hasta: EtapaComercial): boolean {
  return TRANSICIONES_ETAPA[desde].includes(hasta)
}

export function esGanada(etapa: EtapaComercial): boolean {
  return etapa === 'activa'
}

export function esPerdida(etapa: EtapaComercial): boolean {
  return etapa === 'perdida'
}

/**
 * Avance dentro del embudo, de 0 a 100.
 *
 * Una oportunidad perdida devuelve 0: no aporta nada al pronóstico por más
 * lejos que hubiera llegado.
 */
export function progresoPct(etapa: EtapaComercial): number {
  if (esPerdida(etapa)) return 0
  const indice = EMBUDO.indexOf(etapa)
  if (indice < 0) return 0
  return Math.round(((indice + 1) / EMBUDO.length) * 100)
}

/** Cuenta cuántas oportunidades hay en cada etapa, para el tablero del embudo. */
export function conteoPorEtapa(
  agencias: readonly { etapa: EtapaComercial }[],
): Record<EtapaComercial, number> {
  const conteo = Object.fromEntries(
    ETAPAS_COMERCIALES.map((e) => [e, 0]),
  ) as Record<EtapaComercial, number>

  for (const a of agencias) conteo[a.etapa] = (conteo[a.etapa] ?? 0) + 1
  return conteo
}

/**
 * Tasa de conversión: qué proporción de las oportunidades cerradas terminó en
 * una cuenta activa. Las que siguen en el embudo no se cuentan, porque todavía
 * no se sabe cómo terminan.
 */
export function tasaConversion(agencias: readonly { etapa: EtapaComercial }[]): number | null {
  const ganadas = agencias.filter((a) => esGanada(a.etapa)).length
  const perdidas = agencias.filter((a) => esPerdida(a.etapa)).length
  const cerradas = ganadas + perdidas
  if (cerradas === 0) return null
  return Math.round((ganadas / cerradas) * 100)
}
