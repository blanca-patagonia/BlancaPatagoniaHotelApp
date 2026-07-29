'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'

export interface EstadoOrden {
  error?: string
  ok?: string
}

const PRIORIDADES = ['baja', 'media', 'alta']
const ESTADOS = ['pendiente', 'en_proceso', 'resuelta']

export async function crearOrden(_prev: EstadoOrden, formData: FormData): Promise<EstadoOrden> {
  const titulo = String(formData.get('titulo') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const prioridad = String(formData.get('prioridad') ?? 'media')
  const unidadId = String(formData.get('unidad_id') ?? '')
  if (!titulo) return { error: 'Ingresá un título.' }
  if (!PRIORIDADES.includes(prioridad)) return { error: 'Prioridad inválida.' }

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('ordenes_mantenimiento')
    .insert({ titulo, descripcion, prioridad, unidad_id: unidadId || null })
  if (error) return { error: `No se pudo crear: ${error.message}` }
  revalidatePath('/panel/mantenimiento')
  return { ok: 'Orden creada.' }
}

export async function cambiarEstadoOrden(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  if (id && ESTADOS.includes(estado)) {
    const supabase = await crearClienteServidor()
    const upd: { estado: string; resuelta_en?: string | null } = { estado }
    upd.resuelta_en = estado === 'resuelta' ? new Date().toISOString() : null
    await supabase.from('ordenes_mantenimiento').update(upd).eq('id', id)
  }
  redirect('/panel/mantenimiento')
}
