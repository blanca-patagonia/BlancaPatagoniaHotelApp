'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'

export interface EstadoAviso {
  error?: string
  ok?: string
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
  // Sin este mensaje, al vaciarse el campo no hay forma de distinguir «se
  // publicó» de «no pasó nada».
  return { ok: 'Aviso publicado. Ya lo ve todo el equipo.' }
}

/**
 * Fija o desfija un aviso para que quede al tope del tablón.
 *
 * El trigger `avisos_solo_fijar` garantiza en la base que un UPDATE del staff
 * no pueda tocar el texto ni la autoría, solo esta bandera.
 */
export async function alternarFijado(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const fijar = String(formData.get('fijar') ?? '') === '1'
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('avisos').update({ fijado: fijar }).eq('id', id)
    cortarSiFalla(error, '/panel/avisos', 'fijar')
  }
  redirect('/panel/avisos')
}

export async function borrarAviso(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('avisos').delete().eq('id', id)
    cortarSiFalla(error, '/panel/avisos', 'borrar')
  }
  redirect('/panel/avisos')
}
