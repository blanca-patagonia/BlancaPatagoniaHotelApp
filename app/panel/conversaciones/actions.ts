'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { mensajeValido, normalizarMensaje } from '@/lib/domain/conversaciones'
import { cortarSiFalla } from '@/lib/acciones'

/**
 * Publica un mensaje en un canal.
 *
 * No hace falta comprobar acá la pertenencia al canal: la política
 * `mensajes: participantes escriben` la impone en la base con
 * `puede_ver_canal(canal_id)`, y además exige que `autor_id` sea el usuario de
 * la sesión, de modo que nadie pueda escribir en nombre de otro.
 */
export async function enviarMensaje(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/login')

  const canalId = String(formData.get('canal_id') ?? '')
  const cuerpo = String(formData.get('cuerpo') ?? '')
  if (!canalId || !mensajeValido(cuerpo)) redirect(`/panel/conversaciones?canal=${canalId}`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('mensajes').insert({
    canal_id: canalId,
    autor_id: sesion.userId,
    cuerpo: normalizarMensaje(cuerpo),
  })
  // Un mensaje que no se envía y no avisa es peor que un error: quien escribió
  // queda convencido de que el equipo lo leyó.
  cortarSiFalla(error, `/panel/conversaciones?canal=${canalId}`, 'mensaje')

  revalidatePath('/panel/conversaciones')
  redirect(`/panel/conversaciones?canal=${canalId}`)
}

/** Marca una consulta del asistente público como ya atendida. */
export async function marcarConsultaRespondida(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/login')

  const id = String(formData.get('consulta_id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('consultas_bot')
      .update({ respondida: true })
      .eq('id', id)
    cortarSiFalla(error, '/panel/conversaciones?vista=consultas', 'consulta')
  }

  revalidatePath('/panel/conversaciones')
  redirect('/panel/conversaciones?vista=consultas')
}
