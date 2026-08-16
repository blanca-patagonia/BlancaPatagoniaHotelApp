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

/**
 * Áreas apagadas por decisión del hotel: no se van a usar por ahora.
 *
 * ── Por qué apagadas y no borradas ──────────────────────────────────────────
 *
 * El código, las tablas, las políticas RLS y los tests siguen enteros. Borrar tres
 * módulos que funcionan para volver a escribirlos si el hotel cambia de idea sería
 * tirar trabajo verificado; y como el sistema es una entrega de tesis, las pantallas
 * siguen siendo demostrables sacando el nombre de esta lista.
 *
 * Para volver a habilitar una, se le quita el nombre de acá. Nada más: no hay que
 * tocar el menú, ni el hub de inicio, ni la Ayuda, ni las páginas.
 *
 * ── Qué apaga exactamente ───────────────────────────────────────────────────
 *
 * Todo lo que pregunta por el área, porque todo pasa por `puedeAcceder`:
 * el menú lateral y el móvil (`_components/shell.tsx` vía `navegacion.ts`), las
 * tarjetas del hub (`app/panel/page.tsx`), el capítulo correspondiente de la Ayuda
 * (`lib/domain/ayuda.ts`) y el `requerirAcceso` de cada página y cada Server Action
 * del módulo. Entrar a la URL a mano tampoco sirve: `requerirAcceso` redirige.
 *
 * ⚠️ Lo que NO apaga, y es deliberado: la **tabla** `auditoria` sigue registrando
 * las operaciones sensibles. Lo que se oculta es la pantalla que las muestra, no el
 * registro. Un rastro de auditoría que se deja de escribir porque nadie lo mira
 * pierde justamente el valor que tiene —estar ahí cuando hay que revisar algo que
 * pasó antes—, y volver a encenderlo no recupera lo que no se guardó.
 */
export const AREAS_OCULTAS: readonly Area[] = ['auditoria', 'conversaciones', 'objetos_perdidos']

export function estaOculta(area: Area): boolean {
  return AREAS_OCULTAS.includes(area)
}

export function areasDe(rol: Rol): readonly Area[] {
  return PERMISOS[rol].filter((a) => !estaOculta(a))
}

export function puedeAcceder(rol: Rol, area: Area): boolean {
  if (estaOculta(area)) return false
  return PERMISOS[rol].includes(area)
}
