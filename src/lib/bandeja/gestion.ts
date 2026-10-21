import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import type { AjustesBandeja, CanalBandeja, EstadoConversacion, Prioridad, TonoEtiqueta } from '@/lib/domain/bandeja'

/**
 * Escrituras de la bandeja de mensajes (ADR 0043).
 *
 * Con el cliente del USUARIO: RLS (0125) es la segunda barrera después de la
 * verificación de rol de la Server Action, y la que deja cada mensaje a nombre
 * de quien lo escribió. Cada función devuelve el error de la base —nunca lo
 * descarta—: la acción decide si corta (`cortarSiFalla`) o lo muestra.
 */

export interface ErrorBase {
  message: string
  code?: string
}

export interface CambiosConversacion {
  estado?: EstadoConversacion
  pospuesta_hasta?: string | null
  esperando_desde?: null
  asignada_a?: string | null
  prioridad?: Prioridad | null
  reserva_id?: string | null
}

export async function actualizarConversacion(id: string, cambios: CambiosConversacion): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('crm_conversaciones').update(cambios).eq('id', id)
  return error
}

/** El renglón «Laura la marcó como resuelta». Accesorio: se registra, no corta. */
export async function registrarActividad(conversacionId: string, autorId: string, texto: string): Promise<void> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('crm_mensajes')
    .insert({ conversacion_id: conversacionId, tipo: 'actividad', contenido: texto, autor_id: autorId })
  registrarFalla(error, 'bandeja:actividad')
}

/** ¿Se le puede asignar una conversación? Sólo a quien atiende la bandeja. */
export async function perfilAsignable(
  id: string,
): Promise<{ perfil: { nombre: string } | null; error: ErrorBase | null }> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('perfiles')
    .select('nombre, rol, activo')
    .eq('id', id)
    .maybeSingle<{ nombre: string; rol: string; activo: boolean }>()
  if (error) return { perfil: null, error }
  const valido = data && data.activo && ['admin', 'gerencia', 'recepcion'].includes(data.rol)
  return { perfil: valido ? { nombre: data.nombre } : null, error: null }
}

export async function marcarConversacionLeida(id: string): Promise<void> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('crm_conversaciones').update({ no_leidos: 0 }).eq('id', id).gt('no_leidos', 0)
  registrarFalla(error, 'bandeja:marcar_leida')
}

export async function ponerEtiqueta(conversacionId: string, etiquetaId: string): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('crm_conversacion_etiquetas')
    .upsert({ conversacion_id: conversacionId, etiqueta_id: etiquetaId }, { ignoreDuplicates: true })
  return error
}

export async function sacarEtiqueta(conversacionId: string, etiquetaId: string): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('crm_conversacion_etiquetas')
    .delete()
    .eq('conversacion_id', conversacionId)
    .eq('etiqueta_id', etiquetaId)
  return error
}

export interface CambiosContacto {
  nombre?: string
  email?: string | null
  telefono?: string | null
  notas?: string | null
  huesped_id?: string | null
  bloqueado?: boolean
}

export async function actualizarContacto(id: string, cambios: CambiosContacto): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('crm_contactos').update(cambios).eq('id', id)
  return error
}

// ── Ajustes: respuestas guardadas y etiquetas ───────────────────────────────

export async function guardarRespuestaGuardada(
  id: string | null,
  datos: { atajo: string; contenido: string },
): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = id
    ? await supabase.from('crm_respuestas').update(datos).eq('id', id)
    : await supabase.from('crm_respuestas').insert(datos)
  return error
}

export async function borrarRespuestaGuardada(id: string): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('crm_respuestas').delete().eq('id', id)
  return error
}

export async function guardarEtiquetaBandeja(
  id: string | null,
  datos: { nombre: string; color: TonoEtiqueta },
): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = id
    ? await supabase.from('crm_etiquetas').update(datos).eq('id', id)
    : await supabase.from('crm_etiquetas').insert(datos)
  return error
}

export async function borrarEtiquetaBandeja(id: string): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('crm_etiquetas').delete().eq('id', id)
  return error
}

/** Ajustes de una bandeja: saludo, fuera de horario, horario y asignación (ADR 0044). */
export async function guardarAjustesDeBandeja(canal: CanalBandeja, a: AjustesBandeja): Promise<ErrorBase | null> {
  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('crm_bandejas')
    .update({
      activa: a.activa,
      saludo_activo: a.saludoActivo,
      saludo_mensaje: a.saludoMensaje,
      fuera_horario_activo: a.fueraHorarioActivo,
      fuera_horario_mensaje: a.fueraHorarioMensaje,
      horario_desde: a.horarioDesde,
      horario_hasta: a.horarioHasta,
      dias_atencion: a.dias,
      asignacion_automatica: a.asignacionAutomatica,
    })
    .eq('canal', canal)
  return error
}
