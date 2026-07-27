'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'

export async function cambiarEstadoUnidad(formData: FormData): Promise<void> {
  const id = String(formData.get('unidad_id') ?? '')
  const estado = String(formData.get('estado') ?? '') as EstadoHousekeeping
  if (!id || !ESTADOS_HK.includes(estado)) redirect('/panel/housekeeping')

  const supabase = await crearClienteServidor()
  await supabase.from('unidades').update({ estado }).eq('id', id)
  redirect('/panel/housekeeping')
}
