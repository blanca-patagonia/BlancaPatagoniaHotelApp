'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'

export interface EstadoObjeto {
  error?: string
  ok?: string
}

/**
 * Una Server Action es un endpoint HTTP público: se invoca con un POST sin pasar
 * por la pantalla. Cada una verifica el rol por sí misma contra
 * `lib/domain/permisos.ts` (auditoría · Fase 3).
 */
export async function crearObjeto(_prev: EstadoObjeto, formData: FormData): Promise<EstadoObjeto> {
  await requerirAcceso('objetos_perdidos')
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
  await requerirAcceso('objetos_perdidos')
  const id = String(formData.get('id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('objetos_perdidos')
      .update({ estado: 'devuelto' })
      .eq('id', id)
    cortarSiFalla(error, '/panel/objetos-perdidos', 'devuelto')
  }
  redirect('/panel/objetos-perdidos')
}
