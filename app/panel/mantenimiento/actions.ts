'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { periodicidadValida, primeraEjecucionSugerida } from '@/lib/domain/preventivo'
import { hoyISO } from '@/lib/fechas'

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

/**
 * Da de alta un plan de mantenimiento preventivo.
 *
 * La primera ejecución se propone dentro de una semana (ver `preventivo.ts`)
 * para no llenar el tablero de órdenes apenas se carga el plan.
 */
export async function crearPlanPreventivo(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const titulo = String(formData.get('titulo') ?? '').trim()
  const unidadId = String(formData.get('unidad_id') ?? '')
  const cadaMeses = Number(formData.get('cada_meses'))
  const prioridad = String(formData.get('prioridad') ?? 'media')

  if (!titulo || !periodicidadValida(cadaMeses)) {
    redirect('/panel/mantenimiento?error=plan')
  }

  const supabase = await crearClienteServidor()
  await supabase.from('planes_mantenimiento').insert({
    titulo,
    unidad_id: unidadId || null,
    cada_meses: cadaMeses,
    prioridad,
    proxima_ejecucion: primeraEjecucionSugerida(hoyISO()),
  })

  revalidatePath('/panel/mantenimiento')
  redirect('/panel/mantenimiento?ok=plan')
}

/**
 * Ejecuta los planes vencidos y genera sus órdenes.
 *
 * Hoy se dispara a mano desde el panel; en producción iría por cron, igual que
 * `expirar_reservas_pendientes`. La lógica vive en la base para que valga sea
 * cual sea el disparador.
 */
export async function generarPreventivo(): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const supabase = await crearClienteServidor()
  const { data } = await supabase.rpc('generar_mantenimiento_preventivo')

  revalidatePath('/panel/mantenimiento')
  redirect(`/panel/mantenimiento?generadas=${data ?? 0}`)
}
