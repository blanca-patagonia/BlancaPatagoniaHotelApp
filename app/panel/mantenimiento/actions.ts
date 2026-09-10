'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso, requerirRol } from '@/lib/auth/session'
import {
  periodicidadValida,
  primeraEjecucionSugerida,
  proximaEjecucion,
} from '@/lib/domain/preventivo'
import { hoyISO } from '@/lib/fechas'
import { cortarSiFalla } from '@/lib/acciones'
import { avisarIncidenteMantenimiento } from '@/lib/notificaciones/eventos'

export interface EstadoOrden {
  error?: string
  ok?: string
}

const PRIORIDADES = ['baja', 'media', 'alta']
const ESTADOS = ['pendiente', 'en_proceso', 'resuelta']

export async function crearOrden(_prev: EstadoOrden, formData: FormData): Promise<EstadoOrden> {
  await requerirAcceso('mantenimiento')
  const titulo = String(formData.get('titulo') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const prioridad = String(formData.get('prioridad') ?? 'media')
  const unidadId = String(formData.get('unidad_id') ?? '')
  if (!titulo) return { error: 'Ingresá un título.' }
  if (!PRIORIDADES.includes(prioridad)) return { error: 'Prioridad inválida.' }

  const supabase = await crearClienteServidor()
  const { data: creada, error } = await supabase
    .from('ordenes_mantenimiento')
    .insert({ titulo, descripcion, prioridad, unidad_id: unidadId || null })
    .select('id, unidad:unidades(nombre)')
    .single()
  if (error) return { error: `No se pudo crear: ${error.message}` }

  /*
    Sólo lo urgente sale a la cartelera.

    Una orden de prioridad baja —«cambiar la lamparita del pasillo»— no necesita
    interrumpir a nadie, y si todas avisaran, la cartelera se llenaría de cosas
    que pueden esperar y se dejaría de mirar. La que no puede esperar es la que
    deja una habitación fuera de servicio.
  */
  if (prioridad === 'alta') {
    const orden = creada as unknown as {
      id: string
      // ⚠️ PostgREST tipa el embed como arreglo aunque la relación sea a-uno.
      unidad: { nombre: string }[] | null
    }
    await avisarIncidenteMantenimiento(supabase, {
      ordenId: orden.id,
      // Una orden puede no tener unidad (algo del edificio, no de una habitación).
      unidad: orden.unidad?.[0]?.nombre ?? 'Sin unidad asignada',
      titulo,
      prioridad: 'alta',
    })
  }

  revalidatePath('/panel/mantenimiento')
  return { ok: 'Orden creada.' }
}

export async function cambiarEstadoOrden(formData: FormData): Promise<void> {
  await requerirAcceso('mantenimiento')
  const id = String(formData.get('id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  if (id && ESTADOS.includes(estado)) {
    const supabase = await crearClienteServidor()
    const upd: { estado: string; resuelta_en?: string | null } = { estado }
    upd.resuelta_en = estado === 'resuelta' ? new Date().toISOString() : null
    const { error } = await supabase.from('ordenes_mantenimiento').update(upd).eq('id', id)
    cortarSiFalla(error, '/panel/mantenimiento', 'estado_orden')
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
  await requerirRol('admin', 'gerencia')

  const titulo = String(formData.get('titulo') ?? '').trim()
  const unidadId = String(formData.get('unidad_id') ?? '')
  const cadaMeses = Number(formData.get('cada_meses'))
  const prioridad = String(formData.get('prioridad') ?? 'media')

  if (!titulo || !periodicidadValida(cadaMeses)) {
    redirect('/panel/mantenimiento?error=plan')
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('planes_mantenimiento').insert({
    titulo,
    unidad_id: unidadId || null,
    cada_meses: cadaMeses,
    prioridad,
    proxima_ejecucion: primeraEjecucionSugerida(hoyISO()),
  })
  cortarSiFalla(error, '/panel/mantenimiento', 'plan_guardar')

  revalidatePath('/panel/mantenimiento')
  redirect('/panel/mantenimiento?ok=plan')
}

/**
 * Da de baja un plan preventivo (baja lógica: `activo = false`).
 *
 * No se borra la fila: es el mismo criterio que ya usa el resto del sistema
 * para lo que tiene historial (huéspedes, agencias…), y acá además evita que
 * una orden ya generada por este plan se quede apuntando a nada.
 */
export async function eliminarPlanPreventivo(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const id = String(formData.get('id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('planes_mantenimiento')
      .update({ activo: false })
      .eq('id', id)
    cortarSiFalla(error, '/panel/mantenimiento', 'plan_eliminar')
  }

  revalidatePath('/panel/mantenimiento')
  redirect('/panel/mantenimiento?ok=plan_eliminado')
}

/**
 * Registra que la tarea se hizo hoy, fuera del ciclo automático, y calcula
 * la próxima ejecución a partir de HOY (no de la fecha vencida).
 *
 * Sin esto, la única forma de que un plan avance era esperar a que quedara
 * vencido y generar la orden — no hay manera de anotar «esto ya se hizo» si
 * se resolvió por afuera del sistema (una visita del técnico sin pasar por
 * la orden).
 */
export async function marcarPlanHecho(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const id = String(formData.get('id') ?? '')
  const cadaMeses = Number(formData.get('cada_meses'))
  if (id && periodicidadValida(cadaMeses)) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('planes_mantenimiento')
      .update({ proxima_ejecucion: proximaEjecucion(hoyISO(), cadaMeses) })
      .eq('id', id)
    cortarSiFalla(error, '/panel/mantenimiento', 'plan_marcar_hecho')
  }

  revalidatePath('/panel/mantenimiento')
  redirect('/panel/mantenimiento?ok=plan_hecho')
}

/**
 * Ejecuta los planes vencidos y genera sus órdenes.
 *
 * Hoy se dispara a mano desde el panel; en producción iría por cron, igual que
 * `expirar_reservas_pendientes`. La lógica vive en la base para que valga sea
 * cual sea el disparador.
 */
export async function generarPreventivo(): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const supabase = await crearClienteServidor()
  const { data } = await supabase.rpc('generar_mantenimiento_preventivo')

  revalidatePath('/panel/mantenimiento')
  redirect(`/panel/mantenimiento?generadas=${data ?? 0}`)
}
