'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'

export interface EstadoObjeto {
  error?: string
  ok?: string
}

export async function crearObjeto(_prev: EstadoObjeto, formData: FormData): Promise<EstadoObjeto> {
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const ubicacion = String(formData.get('ubicacion') ?? '').trim()
  if (!descripcion) return { error: 'Describí el objeto encontrado.' }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('objetos_perdidos').insert({ descripcion, ubicacion })
  if (error) return { error: `No se pudo registrar: ${error.message}` }
  revalidatePath('/panel/objetos-perdidos')
  return { ok: 'Objeto registrado.' }
}

export async function marcarDevuelto(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    await supabase.from('objetos_perdidos').update({ estado: 'devuelto' }).eq('id', id)
  }
  redirect('/panel/objetos-perdidos')
}
