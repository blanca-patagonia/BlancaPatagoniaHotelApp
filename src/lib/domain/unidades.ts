/**
 * Tipos del dominio de inventario. Deben mantenerse en sincronía con los enums
 * de la base (ver `supabase/migrations/0002_inventario.sql`).
 */

export const CATEGORIAS_UNIDAD = ['hosteria', 'cabana'] as const
export type CategoriaUnidad = (typeof CATEGORIAS_UNIDAD)[number]

export const ESTADOS_HK = ['limpia', 'sucia', 'inspeccionada', 'bloqueada'] as const
export type EstadoHousekeeping = (typeof ESTADOS_HK)[number]

export const ETIQUETAS_CATEGORIA: Record<CategoriaUnidad, string> = {
  hosteria: 'Hostería Boutique',
  cabana: 'Cabaña',
}

export const ETIQUETAS_ESTADO_HK: Record<EstadoHousekeeping, string> = {
  limpia: 'Limpia',
  sucia: 'Sucia',
  inspeccionada: 'Inspeccionada',
  bloqueada: 'Bloqueada',
}

/**
 * Verifica que la cantidad de huéspedes entre en el tipo de unidad.
 *
 * Devuelve `null` si está bien, o el mensaje para mostrar si no.
 *
 * Por qué existe. El límite de capacidad vivía **solo en el filtro de la
 * pantalla** del portal público: se usaba para no ofrecer una cabaña de cuatro a
 * quien busca para seis, y nada más. El alta (`app/reservar/actions.ts`) tomaba
 * la cantidad con `Math.max(1, …)`, que pone piso pero no techo, así que un
 * envío directo con `huespedes: 50` sobre una habitación doble entraba sin
 * objeción. El hotel se enteraba en el mostrador.
 *
 * La regla es de negocio y por eso está acá, en el dominio: la comparten el
 * portal público y el panel, y se puede probar sin base.
 */
export function validarCapacidad(huespedes: number, capacidadMax: number): string | null {
  if (!Number.isInteger(huespedes) || huespedes < 1) {
    return 'Indicá cuántas personas se alojan (al menos una).'
  }
  if (!Number.isFinite(capacidadMax) || capacidadMax < 1) {
    // Sin un máximo conocido no se puede afirmar que entren: se rechaza en vez
    // de asumir que sí. Es un dato de catálogo que siempre debería estar.
    return 'No se pudo verificar la capacidad de ese alojamiento.'
  }
  if (huespedes > capacidadMax) {
    return `Ese alojamiento admite hasta ${capacidadMax} ${capacidadMax === 1 ? 'persona' : 'personas'}.`
  }
  return null
}
