/**
 * Informes de la bandeja (lógica pura, ADR 0044).
 *
 * Los números que Chatwoot muestra en su pantalla de informes —conversaciones,
 * tiempo de primera respuesta, tiempo de resolución, por canal y por agente—,
 * calculados sobre las filas que devuelve la base.
 *
 * ⚠️ Mediana y no promedio. Un huésped que escribe a las 23:00 y recibe
 * respuesta a las 8:00 son 9 horas; con unas pocas conversaciones así el
 * promedio dice «tardamos 5 horas» cuando la mayoría se contesta en diez
 * minutos. La mediana dice lo que le pasa a un huésped típico, y es lo que el
 * hotel puede prometer.
 */

import type { CanalBandeja, EstadoConversacion } from './bandeja'

export interface FilaInforme {
  canal: CanalBandeja
  estado: EstadoConversacion
  asignada_a: string | null
  creado_en: string
  primera_respuesta_en: string | null
  resuelta_en: string | null
  /** Sigue esperando a una persona. */
  esperando_desde: string | null
}

export interface ResumenInforme {
  total: number
  abiertas: number
  resueltas: number
  sinResponder: number
  /** Minutos. `null` si ninguna se respondió todavía. */
  medianaPrimeraRespuesta: number | null
  medianaResolucion: number | null
  /** Qué parte de las conversaciones del período recibió una respuesta de una persona. */
  porcentajeRespondidas: number | null
  porCanal: { canal: CanalBandeja; total: number; medianaPrimeraRespuesta: number | null }[]
  porAgente: { agenteId: string | null; total: number; resueltas: number }[]
}

function minutosEntre(desde: string, hasta: string): number | null {
  const m = (new Date(hasta).getTime() - new Date(desde).getTime()) / 60_000
  // Una fecha de respuesta anterior a la de creación es un dato roto (un eco
  // con la hora del teléfono): no entra al promedio en vez de dar negativos.
  return Number.isFinite(m) && m >= 0 ? m : null
}

export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2
}

export function resumirInforme(filas: readonly FilaInforme[]): ResumenInforme {
  const tiemposRespuesta = filas
    .map((f) => (f.primera_respuesta_en ? minutosEntre(f.creado_en, f.primera_respuesta_en) : null))
    .filter((x): x is number => x !== null)
  const tiemposResolucion = filas
    .map((f) => (f.resuelta_en ? minutosEntre(f.creado_en, f.resuelta_en) : null))
    .filter((x): x is number => x !== null)

  const canales = [...new Set(filas.map((f) => f.canal))]
  const agentes = [...new Set(filas.map((f) => f.asignada_a))]

  return {
    total: filas.length,
    abiertas: filas.filter((f) => f.estado === 'abierta' || f.estado === 'pendiente').length,
    resueltas: filas.filter((f) => f.estado === 'resuelta').length,
    sinResponder: filas.filter((f) => f.esperando_desde !== null && f.estado !== 'resuelta').length,
    medianaPrimeraRespuesta: mediana(tiemposRespuesta),
    medianaResolucion: mediana(tiemposResolucion),
    porcentajeRespondidas: filas.length ? Math.round((filas.filter((f) => f.primera_respuesta_en).length / filas.length) * 100) : null,
    porCanal: canales
      .map((canal) => {
        const delCanal = filas.filter((f) => f.canal === canal)
        return {
          canal,
          total: delCanal.length,
          medianaPrimeraRespuesta: mediana(
            delCanal
              .map((f) => (f.primera_respuesta_en ? minutosEntre(f.creado_en, f.primera_respuesta_en) : null))
              .filter((x): x is number => x !== null),
          ),
        }
      })
      .sort((a, b) => b.total - a.total),
    porAgente: agentes
      .map((agenteId) => {
        const suyas = filas.filter((f) => f.asignada_a === agenteId)
        return { agenteId, total: suyas.length, resueltas: suyas.filter((f) => f.estado === 'resuelta').length }
      })
      .sort((a, b) => b.total - a.total),
  }
}

/** «12 min», «3 h 20 min», «2 d 4 h»: un tiempo en minutos, legible. */
export function duracionLegible(minutos: number | null): string {
  if (minutos === null) return '—'
  const m = Math.round(minutos)
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

export const PERIODOS_INFORME = [7, 30, 90] as const
export type PeriodoInforme = (typeof PERIODOS_INFORME)[number]
