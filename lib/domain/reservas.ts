/**
 * Máquina de estados de la reserva (lógica pura).
 *
 * Ciclo de vida:
 *   pendiente → confirmada → pagada → in_house → checkout
 *   (con salidas a cancelada / no_show según el momento)
 *
 * Debe mantenerse en sincronía con el enum `estado_reserva` de la base
 * (ver `supabase/migrations/0005_reservas_ocupacion.sql`).
 */

export const ESTADOS_RESERVA = [
  'pendiente',
  'confirmada',
  'pagada',
  'in_house',
  'checkout',
  'cancelada',
  'no_show',
] as const

export type EstadoReserva = (typeof ESTADOS_RESERVA)[number]

export const ETIQUETAS_ESTADO_RESERVA: Record<EstadoReserva, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  pagada: 'Pagada',
  in_house: 'In house',
  checkout: 'Check-out',
  cancelada: 'Cancelada',
  no_show: 'No-show',
}

/** Estados que OCUPAN inventario (bloquean la unidad en el motor anti-overbooking). */
export const ESTADOS_ACTIVOS: readonly EstadoReserva[] = [
  'pendiente',
  'confirmada',
  'pagada',
  'in_house',
]

/** Transiciones válidas desde cada estado. */
export const TRANSICIONES: Record<EstadoReserva, readonly EstadoReserva[]> = {
  pendiente: ['confirmada', 'cancelada'],
  confirmada: ['pagada', 'in_house', 'cancelada', 'no_show'],
  pagada: ['in_house', 'cancelada', 'no_show'],
  in_house: ['checkout'],
  checkout: [],
  cancelada: [],
  no_show: [],
}

/** ¿El estado es terminal (no admite más transiciones)? */
export function esTerminal(estado: EstadoReserva): boolean {
  return TRANSICIONES[estado].length === 0
}

/** ¿El estado ocupa inventario? */
export function ocupaInventario(estado: EstadoReserva): boolean {
  return ESTADOS_ACTIVOS.includes(estado)
}

/** Estados a los que se puede pasar desde el actual. */
export function transicionesPosibles(estado: EstadoReserva): readonly EstadoReserva[] {
  return TRANSICIONES[estado]
}

/** ¿Es válido pasar de `desde` a `hacia`? */
export function puedeTransicionar(desde: EstadoReserva, hacia: EstadoReserva): boolean {
  return TRANSICIONES[desde].includes(hacia)
}
