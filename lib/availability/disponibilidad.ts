import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { CategoriaUnidad } from '@/lib/domain/unidades'

/**
 * Motor de disponibilidad (capa de acceso). La garantía anti-overbooking vive en
 * la base (restricción de exclusión, ver ADR 0002); estas funciones solo
 * consultan la disponibilidad calculada por las funciones SQL.
 */

export interface DisponibilidadTipo {
  tipo_unidad_id: string
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  capacidad_max: number
  disponibles: number
}

export interface UnidadDisponible {
  id: string
  tipo_unidad_id: string
  nombre: string
}

/**
 * Disponibilidad agregada por tipo de unidad para el rango `[desde, hasta)`.
 * Apta para el portal público (no expone unidades ni ocupación individual).
 */
export async function disponibilidadPorTipo(
  desde: string,
  hasta: string,
  categoria?: CategoriaUnidad,
): Promise<DisponibilidadTipo[]> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('disponibilidad_por_tipo', {
    desde,
    hasta,
    p_categoria: categoria ?? null,
  })
  if (error) throw new Error(`Error al consultar disponibilidad: ${error.message}`)
  return (data ?? []) as DisponibilidadTipo[]
}

/**
 * Unidades libres concretas para el rango `[desde, hasta)`. Uso interno
 * (recepción) para asignar una unidad a una reserva.
 */
export async function unidadesDisponibles(
  desde: string,
  hasta: string,
  categoria?: CategoriaUnidad,
): Promise<UnidadDisponible[]> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('unidades_disponibles', {
    desde,
    hasta,
    p_categoria: categoria ?? null,
  })
  if (error) throw new Error(`Error al consultar unidades disponibles: ${error.message}`)
  return (data ?? []) as UnidadDisponible[]
}
