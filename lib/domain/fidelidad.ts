/**
 * Programa de fidelidad (lógica pura). El huésped acumula puntos por sus estadías
 * y alcanza niveles. Inspirado en el módulo de fidelidad de WinPax / Odoo.
 */

export const NIVELES = ['bronce', 'plata', 'oro', 'platino'] as const
export type NivelFidelidad = (typeof NIVELES)[number]

export const ETIQUETAS_NIVEL: Record<NivelFidelidad, string> = {
  bronce: 'Bronce',
  plata: 'Plata',
  oro: 'Oro',
  platino: 'Platino',
}

// Umbrales de puntos (de mayor a menor) para resolver el nivel.
const UMBRALES: { nivel: NivelFidelidad; desde: number }[] = [
  { nivel: 'platino', desde: 5000 },
  { nivel: 'oro', desde: 2000 },
  { nivel: 'plata', desde: 500 },
  { nivel: 'bronce', desde: 0 },
]

export function nivelFidelidad(puntos: number): NivelFidelidad {
  for (const u of UMBRALES) if (puntos >= u.desde) return u.nivel
  return 'bronce'
}

/** Puntos que otorga una estadía: 1 punto por cada USD 10 del total facturado. */
export function puntosPorEstadia(total: number): number {
  return Math.floor(Math.max(0, total) / 10)
}
