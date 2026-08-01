import type { EstadoReserva } from '@/lib/domain/reservas'
import type { EstadoHousekeeping } from '@/lib/domain/unidades'
import type { Tono } from './ui'

/** Tono de la etiqueta de cada estado de reserva. */
export const TONO_ESTADO: Record<EstadoReserva, Tono> = {
  pendiente: 'neutro',
  confirmada: 'lago',
  pagada: 'exito',
  in_house: 'alerta',
  checkout: 'neutro',
  cancelada: 'peligro',
  no_show: 'peligro',
}

/** Color del punto que indica el estado de limpieza de una unidad. */
export const PUNTO_HK: Record<EstadoHousekeeping, string> = {
  limpia: 'bg-emerald-500',
  sucia: 'bg-lenga-500',
  inspeccionada: 'bg-lago-500',
  bloqueada: 'bg-red-500',
}

/** Tono de la etiqueta de cada estado de limpieza. */
export const TONO_HK: Record<EstadoHousekeeping, Tono> = {
  limpia: 'exito',
  sucia: 'alerta',
  inspeccionada: 'lago',
  bloqueada: 'peligro',
}
