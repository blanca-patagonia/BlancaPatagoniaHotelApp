'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'

export interface EstadoAviso {
  error?: string
}

export async function publicarAviso(_prev: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/login')
  const mensaje = String(formData.get('mensaje') ?? '').trim()
  if (!mensaje) return { error: 'Escribí un mensaje.' }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('avisos').insert({ mensaje, autor_id: sesion.userId })
  if (error) return { error: 'No se pudo publicar el aviso.' }
  revalidatePath('/panel/avisos')
  return {}
}

export async function borrarAviso(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    await supabase.from('avisos').delete().eq('id', id)
  }
  redirect('/panel/avisos')
}
