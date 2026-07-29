/**
 * Control de acceso por rol (lógica pura). Define qué áreas del panel interno
 * puede ver cada rol. La seguridad de datos la impone RLS en la base; esto
 * gobierna la navegación y el gating de las pantallas.
 */

import type { Rol } from './roles'

export const AREAS = [
  'dashboard',
  'ocupacion',
  'reservas',
  'huespedes',
  'housekeeping',
  'agencias',
  'reportes',
  'config',
  'usuarios',
] as const

export type Area = (typeof AREAS)[number]

export const ETIQUETAS_AREA: Record<Area, string> = {
  dashboard: 'Inicio',
  ocupacion: 'Ocupación',
  reservas: 'Reservas',
  huespedes: 'Huéspedes',
  housekeeping: 'Housekeeping',
  agencias: 'Agencias',
  reportes: 'Reportes',
  config: 'Configuración',
  usuarios: 'Usuarios',
}

/** Áreas accesibles por rol. */
export const PERMISOS: Record<Rol, readonly Area[]> = {
  admin: [...AREAS],
  gerencia: ['dashboard', 'ocupacion', 'reservas', 'huespedes', 'housekeeping', 'agencias', 'reportes', 'config'],
  recepcion: ['dashboard', 'ocupacion', 'reservas', 'huespedes', 'agencias'],
  housekeeping: ['dashboard', 'housekeeping'],
}

export function areasDe(rol: Rol): readonly Area[] {
  return PERMISOS[rol]
}

export function puedeAcceder(rol: Rol, area: Area): boolean {
  return PERMISOS[rol].includes(area)
}
