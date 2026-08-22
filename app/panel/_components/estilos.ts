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

/**
 * Símbolo de cada estado de limpieza.
 *
 * Los cuatro estados se distinguían **solo por el color del punto**, y dos de
 * ellos son verde y naranja: para un daltonismo rojo-verde —el más común, y
 * afecta a alrededor de 1 de cada 12 varones— la grilla de ocupación quedaba
 * ilegible. El color se conserva, porque para quien lo ve es el canal más
 * rápido, pero deja de ser el único: el símbolo distingue igual en blanco y
 * negro, y va acompañado del nombre del estado para el lector de pantalla.
 *
 * Se eligieron símbolos con significado propio y no letras: la inicial de
 * «limpia» y la de «bloqueada» se confunden a 10 px, y además no sobrevivirían
 * a una traducción.
 */
export const SIMBOLO_HK: Record<EstadoHousekeeping, string> = {
  limpia: '✓',
  sucia: '•',
  inspeccionada: '★',
  bloqueada: '✕',
}

/** Tono de la etiqueta de cada estado de limpieza. */
export const TONO_HK: Record<EstadoHousekeeping, Tono> = {
  limpia: 'exito',
  sucia: 'alerta',
  inspeccionada: 'lago',
  bloqueada: 'peligro',
}
