'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { cortarSiFalla, mensajeDeFalla } from '@/lib/acciones'
import { validarGasto } from '@/lib/domain/gastos'
import { falloConValores, type ValoresFormulario } from '@/lib/domain/formularios'

export interface EstadoGasto {
  error?: string
  ok?: string
  /** Lo escrito, para reponerlo si la acción falla (React resetea el form). */
  valores?: ValoresFormulario
}

export async function crearGasto(_prev: EstadoGasto, formData: FormData): Promise<EstadoGasto> {
  const sesion = await requerirAcceso('conciliacion')
  const categoria = String(formData.get('categoria') ?? '')
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const monto = Number(formData.get('monto') ?? 0)
  const fecha = String(formData.get('fecha') ?? '')

  const problema = validarGasto({ categoria, descripcion, monto })
  if (problema) return falloConValores(problema, formData)

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('gastos_operativos').insert({
    categoria,
    descripcion,
    monto,
    fecha: fecha || undefined,
    creado_por: sesion.userId,
  })
  if (error) return falloConValores(mensajeDeFalla(error, 'gastos:registrar', 'No se pudo registrar el gasto'), formData)

  revalidatePath('/panel/conciliacion/gastos')
  return { ok: 'Gasto registrado.' }
}

export async function eliminarGasto(formData: FormData): Promise<void> {
  await requerirAcceso('conciliacion')
  const id = String(formData.get('id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('gastos_operativos').delete().eq('id', id)
    cortarSiFalla(error, '/panel/conciliacion/gastos', 'eliminar')
  }
  redirect('/panel/conciliacion/gastos')
}
