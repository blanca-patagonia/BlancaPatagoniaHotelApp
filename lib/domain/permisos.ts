/**
 * Control de acceso por rol (lógica pura). Define qué áreas del panel interno
 * puede ver cada rol. La seguridad de datos la impone RLS en la base; esto
 * gobierna la navegación y el gating de las pantallas.
 */

import type { Rol } from './roles'

export const AREAS = [
  'dashboard',
  'ocupacion',
  'servicio',
  'punto_venta',
  'reservas',
  'huespedes',
  'housekeeping',
  'mantenimiento',
  'objetos_perdidos',
  'avisos',
  'conversaciones',
  'agencias',
  'proveedores',
  'contratos',
  'canales',
  'auditoria',
  'reportes',
  'config',
  'usuarios',
  'respaldos',
  'ayuda',
] as const

export type Area = (typeof AREAS)[number]

export const ETIQUETAS_AREA: Record<Area, string> = {
  dashboard: 'Inicio',
  ocupacion: 'Ocupación',
  servicio: 'Servicio de cocina',
  punto_venta: 'Punto de venta',
  reservas: 'Reservas',
  huespedes: 'Huéspedes',
  housekeeping: 'Housekeeping',
  mantenimiento: 'Mantenimiento',
  objetos_perdidos: 'Objetos perdidos',
  avisos: 'Avisos',
  conversaciones: 'Conversaciones',
  agencias: 'Agencias',
  proveedores: 'Proveedores',
  contratos: 'Contratos',
  canales: 'Canales de venta',
  auditoria: 'Auditoría',
  reportes: 'Reportes',
  config: 'Configuración',
  usuarios: 'Usuarios',
  respaldos: 'Respaldos',
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
    'dashboard', 'ocupacion', 'servicio', 'punto_venta', 'reservas', 'huespedes', 'housekeeping',
    'mantenimiento', 'objetos_perdidos', 'avisos', 'conversaciones', 'agencias',
    'proveedores', 'contratos', 'canales', 'reportes', 'config',
    // Gerencia **ve** el estado de los respaldos —saber que hace 40 días que nadie
    // exporta es información de gestión— pero **no puede exportar**: eso lo
    // restringe la propia pantalla y el endpoint, porque el archivo concentra los
    // datos personales de todos los huéspedes del hotel.
    'respaldos',
    'ayuda',
  ],
  // Recepción entra a `canales`: las reservas de Booking las importa y las
  // atiende quien está en el mostrador, no gerencia. Es trabajo diario.
  recepcion: [
    'dashboard', 'ocupacion', 'servicio', 'punto_venta', 'reservas', 'huespedes', 'objetos_perdidos',
    'avisos', 'conversaciones', 'agencias', 'canales', 'ayuda',
  ],
  housekeeping: [
    'dashboard', 'housekeeping', 'mantenimiento', 'avisos', 'conversaciones', 'ayuda',
  ],
}

export function areasDe(rol: Rol): readonly Area[] {
  return PERMISOS[rol]
}

export function puedeAcceder(rol: Rol, area: Area): boolean {
  return PERMISOS[rol].includes(area)
}
