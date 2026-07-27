/**
 * Política de cancelación (lógica pura).
 *
 * Regla del Tarifario Blanca Patagonia:
 *  - Más de 14 días antes del check-in: sin cargo.
 *  - Entre 14 y 7 días: se cobra la primera noche.
 *  - Dentro de los 7 días: se cobra el 100 % de la estadía.
 *  - No-show: 100 % de la estadía.
 *
 * Se modela como una lista de umbrales `{ desde_dias, cargo }`: se aplica la
 * primera regla (ordenada de mayor a menor `desde_dias`) cuyo umbral es <= a los
 * días de anticipación de la cancelación.
 */

export type Cargo = 'ninguno' | 'primera_noche' | 'total'

export interface ReglaCancelacion {
  desde_dias: number
  cargo: Cargo
}

/** Determina el tipo de cargo según los días de anticipación de la cancelación. */
export function cargoPorCancelacion(
  reglas: ReglaCancelacion[],
  diasAntes: number,
): Cargo {
  const ordenadas = [...reglas].sort((a, b) => b.desde_dias - a.desde_dias)
  for (const regla of ordenadas) {
    if (diasAntes >= regla.desde_dias) return regla.cargo
  }
  return 'total'
}

/** Traduce el tipo de cargo a un monto concreto. */
export function montoCancelacion(params: {
  cargo: Cargo
  totalEstadia: number
  primeraNoche: number
  noShow?: boolean
}): number {
  if (params.noShow) return params.totalEstadia
  switch (params.cargo) {
    case 'ninguno':
      return 0
    case 'primera_noche':
      return params.primeraNoche
    case 'total':
      return params.totalEstadia
  }
}
