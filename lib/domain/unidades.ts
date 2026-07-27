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
