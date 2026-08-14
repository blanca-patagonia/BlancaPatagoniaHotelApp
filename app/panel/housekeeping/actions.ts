'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { requerirAcceso } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'

/**
 * Una Server Action es un endpoint HTTP público: se invoca con un POST sin pasar
 * por la pantalla. Que la página verifique el rol NO protege la acción, así que
 * cada una lo verifica por sí misma contra `lib/domain/permisos.ts`.
 *
 * Hasta la auditoría de la Fase 3, estas dos acciones no tenían ninguna
 * verificación: la única barrera eran las políticas RLS.
 */
export async function cambiarEstadoUnidad(formData: FormData): Promise<void> {
  await requerirAcceso('housekeeping')
  const id = String(formData.get('unidad_id') ?? '')
  const estado = String(formData.get('estado') ?? '') as EstadoHousekeeping
  if (!id || !ESTADOS_HK.includes(estado)) redirect('/panel/housekeeping')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('unidades').update({ estado }).eq('id', id)
  cortarSiFalla(error, '/panel/housekeeping', 'estado')
  redirect('/panel/housekeeping')
}

/** Asigna (o desasigna) una mucama/o a una unidad. */
export async function asignarMucama(formData: FormData): Promise<void> {
  await requerirAcceso('housekeeping')
  const id = String(formData.get('unidad_id') ?? '')
  const mucamaId = String(formData.get('mucama_id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('unidades')
      .update({ asignada_a: mucamaId || null })
      .eq('id', id)
    cortarSiFalla(error, '/panel/housekeeping', 'asignar')
  }
  redirect('/panel/housekeeping')
}
