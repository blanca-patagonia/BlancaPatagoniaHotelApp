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

/**
 * Franja de color a la izquierda de cada fila del listado de reservas.
 *
 * Es el «toque propio» que pidió el docente al ver el listado («es muy
 * parecido a otros sistemas»): de un vistazo, la columna izquierda dice en qué
 * está cada reserva, como las tarjetas de una planilla de recepción. Sigue la
 * misma paleta que la etiqueta de estado y NO la reemplaza: el color nunca es
 * el único canal (la etiqueta lleva el texto).
 *
 * Es una sombra interior y no un borde para no correr el contenido de la celda.
 * Los colores van escritos (son los de la paleta): Tailwind 4 sólo emite las
 * variables del tema que alguna clase usa, y un `var(--color-…)` dentro de un
 * valor arbitrario no cuenta como uso.
 */
export const FRANJA_ESTADO: Record<EstadoReserva, string> = {
  pendiente: 'shadow-[inset_4px_0_0_#d6d3d1]',
  confirmada: 'shadow-[inset_4px_0_0_#1a7ac4]',
  pagada: 'shadow-[inset_4px_0_0_#10b981]',
  in_house: 'shadow-[inset_4px_0_0_#e5a400]',
  checkout: 'shadow-[inset_4px_0_0_#a8a29e]',
  cancelada: 'shadow-[inset_4px_0_0_#fca5a5]',
  no_show: 'shadow-[inset_4px_0_0_#dc2626]',
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

