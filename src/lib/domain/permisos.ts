/**
 * Control de acceso por rol (lógica pura). Define qué áreas del panel interno
 * puede ver cada rol. La seguridad de datos la impone RLS en la base; esto
 * gobierna la navegación y el gating de las pantallas.
 */

import type { Rol } from './roles'

export const AREAS = [
  'dashboard',
  'ocupacion',
  'punto_venta',
  'reservas',
  'huespedes',
  'housekeeping',
  'auditoria',
  'errores',
  'reportes',
  'config',
  'usuarios',
  'ayuda',
] as const

export type Area = (typeof AREAS)[number]

export const ETIQUETAS_AREA: Record<Area, string> = {
  dashboard: 'Inicio',
  ocupacion: 'Ocupación',
  punto_venta: 'Punto de venta',
  reservas: 'Reservas',
  huespedes: 'Huéspedes',
  housekeeping: 'Housekeeping',
  auditoria: 'Auditoría',
  errores: 'Errores del sistema',
  reportes: 'Reportes',
  config: 'Configuración',
  usuarios: 'Usuarios',
  ayuda: 'Ayuda',
}

/**
 * Áreas accesibles por rol.
 *
 * `ayuda` la tienen **todos**: es la guía de uso del sistema, y quien más la
 * necesita es justamente quien menos permisos tiene. La guía se filtra por
 * dentro para mostrarle a cada uno solo lo que puede hacer.
 */
export const PERMISOS: Record<Rol, readonly Area[]> = {
  admin: [...AREAS],
  gerencia: [
    'dashboard', 'ocupacion', 'punto_venta', 'reservas', 'huespedes', 'housekeeping',
    'reportes', 'config',
    // Gerencia ve los errores del sistema porque es quien decide si hay que
    // llamar a alguien. La política RLS de `errores` (migración 0068) declara
    // los mismos dos roles: si acá se agregara uno más, vería la pantalla vacía.
    'errores',
    'ayuda',
  ],
  recepcion: [
    'dashboard', 'ocupacion', 'punto_venta', 'reservas', 'huespedes',
    'ayuda',
  ],
  housekeeping: [
    'dashboard', 'housekeeping',
    'ayuda',
  ],
}

export function areasDe(rol: Rol): readonly Area[] {
  return PERMISOS[rol]
}

export function puedeAcceder(rol: Rol, area: Area): boolean {
  return PERMISOS[rol].includes(area)
}

/**
 * ¿Es de la dirección del hotel (admin o gerencia)?
 *
 * Para las acciones MÁS restrictivas que el área: recepción entra a
 * reservas, pero algunas operaciones de esas pantallas son sólo de la dirección. La regla estaba escrita a mano 22 veces, en dos formas
 * (`=== … || ===` y `!== … && !==`); una sola definición evita que una se
 * corrija y la otra no.
 */
export function esDireccion(rol: string | null | undefined): boolean {
  return rol === 'admin' || rol === 'gerencia'
}
