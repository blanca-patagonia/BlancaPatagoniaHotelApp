import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import type { EstadoHousekeeping } from '@/lib/domain/unidades'

/**
 * Cambia el estado de limpieza de una unidad.
 *
 * Es la regla de la pantalla de housekeeping (`cambiarEstadoUnidad`) sacada a
 * una función que DEVUELVE el resultado en vez de redirigir.
 *
 * `limpia` la marca quien hizo el trabajo e `inspeccionada` la firma la
 * gobernanta: son dos estados distintos justamente para que recepción pueda
 * distinguir lo que está hecho de lo que además tuvo control de calidad.
 */
export async function fijarEstadoUnidad(
  supabase: SupabaseClient,
  unidadId: string,
  estado: EstadoHousekeeping,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const { error } = await supabase.from('unidades').update({ estado }).eq('id', unidadId)
  if (error) {
    registrarFalla(error, 'housekeeping:cambiar_estado')
    return { ok: false, mensaje: 'No se pudo cambiar el estado de la unidad.' }
  }
  return { ok: true }
}
