import type { EstadoReserva } from '@/lib/domain/reservas'

/** Clases de color para el badge de cada estado de reserva. */
export const BADGE_ESTADO: Record<EstadoReserva, string> = {
  pendiente: 'bg-stone-100 text-stone-700',
  confirmada: 'bg-sky-100 text-sky-800',
  pagada: 'bg-emerald-100 text-emerald-800',
  in_house: 'bg-amber-100 text-amber-800',
  checkout: 'bg-stone-200 text-stone-600',
  cancelada: 'bg-red-100 text-red-700',
  no_show: 'bg-red-100 text-red-700',
}
