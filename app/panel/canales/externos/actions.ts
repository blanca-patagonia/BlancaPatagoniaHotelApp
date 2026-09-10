'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirRol } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'

/**
 * Da de alta un canal externo (channel manager) en el catálogo.
 *
 * El `token` del webhook lo genera la base (`gen_random_uuid()`, migración
 * 0094) — nunca se elige a mano, para que no sea adivinable.
 */
export async function crearCanalExterno(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const codigo = String(formData.get('codigo') ?? '').trim().toLowerCase()
  const nombre = String(formData.get('nombre') ?? '').trim()

  if (!codigo || !nombre) {
    redirect('/panel/canales/externos?error=canal')
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canales_externos').insert({ codigo, nombre })

  revalidatePath('/panel/canales/externos')
  redirect(error ? '/panel/canales/externos?error=canal' : '/panel/canales/externos?ok=canal')
}

/** Activa o desactiva un canal sin borrarlo (conserva el mapeo y el historial de reservas). */
export async function alternarCanalExterno(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('canales_externos')
      .update({ activo: !activo })
      .eq('id', id)
    cortarSiFalla(error, '/panel/canales/externos', 'canal_estado')
  }
  redirect('/panel/canales/externos')
}
