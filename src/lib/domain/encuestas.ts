/**
 * Encuestas de satisfacción y Net Promoter Score (lógica pura).
 *
 * El NPS es el indicador estándar de la hostelería para medir satisfacción:
 * se pregunta «¿qué tan probable es que nos recomiendes?» de 0 a 10 y se
 * clasifica al huésped en detractor, pasivo o promotor.
 *
 * NPS = % promotores − % detractores. Va de −100 a +100; los pasivos cuentan
 * en el total pero no suman ni restan (a propósito: están conformes pero no
 * recomiendan).
 */

export const CATEGORIAS_NPS = ['detractor', 'pasivo', 'promotor'] as const
export type CategoriaNps = (typeof CATEGORIAS_NPS)[number]

export const ETIQUETAS_NPS: Record<CategoriaNps, string> = {
  detractor: 'Detractores',
  pasivo: 'Pasivos',
  promotor: 'Promotores',
}

/** Umbrales estándar del NPS. */
export function clasificarNps(puntaje: number): CategoriaNps {
  if (puntaje <= 6) return 'detractor'
  if (puntaje <= 8) return 'pasivo'
  return 'promotor'
}

/** Un puntaje válido va de 0 a 10, entero. */
export function puntajeValido(puntaje: number): boolean {
  return Number.isInteger(puntaje) && puntaje >= 0 && puntaje <= 10
}

export interface ResumenNps {
  /** Índice NPS de −100 a 100; `null` si todavía no hay respuestas. */
  nps: number | null
  respuestas: number
  promotores: number
  pasivos: number
  detractores: number
  /** Promedio simple del puntaje, como dato complementario. */
  promedio: number | null
}

/**
 * Calcula el NPS de un conjunto de respuestas.
 *
 * Las encuestas sin responder se descartan: incluirlas como cero convertiría a
 * cada huésped que no contestó en un detractor, que es justamente el error
 * clásico al implementar esta métrica.
 */
export function resumenNps(puntajes: readonly (number | null | undefined)[]): ResumenNps {
  const validos = puntajes.filter(
    (p): p is number => typeof p === 'number' && puntajeValido(p),
  )

  if (validos.length === 0) {
    return { nps: null, respuestas: 0, promotores: 0, pasivos: 0, detractores: 0, promedio: null }
  }

  let promotores = 0
  let pasivos = 0
  let detractores = 0
  let suma = 0

  for (const p of validos) {
    suma += p
    const c = clasificarNps(p)
    if (c === 'promotor') promotores++
    else if (c === 'pasivo') pasivos++
    else detractores++
  }

  const total = validos.length
  return {
    nps: Math.round(((promotores - detractores) / total) * 100),
    respuestas: total,
    promotores,
    pasivos,
    detractores,
    promedio: Math.round((suma / total) * 10) / 10,
  }
}

/** Lectura cualitativa del índice, para acompañar el número en el informe. */
export function interpretarNps(nps: number | null): string {
  if (nps === null) return 'Sin respuestas todavía'
  if (nps >= 70) return 'Excelente'
  if (nps >= 50) return 'Muy bueno'
  if (nps >= 0) return 'Aceptable'
  return 'Requiere atención'
}

/** Tasa de respuesta: cuántas de las encuestas enviadas se contestaron. */
export function tasaRespuesta(enviadas: number, respondidas: number): number | null {
  if (enviadas <= 0) return null
  return Math.round((respondidas / enviadas) * 100)
}
