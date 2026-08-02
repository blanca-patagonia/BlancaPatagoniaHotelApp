'use server'

import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerAsistente } from '@/lib/asistente'
import type { RespuestaAsistente } from '@/lib/domain/asistente'

/** Largo máximo aceptado, para no guardar textos abusivos. */
const MAX_PREGUNTA = 500

/**
 * Responde una pregunta del portal público.
 *
 * Si el asistente no supo qué contestar, la consulta se registra en
 * `consultas_bot` para que el staff le dé seguimiento desde el panel.
 *
 * El alta se hace con `service_role` **desde el servidor**: la tabla no tiene
 * política de INSERT para `anon`, así que no queda una tabla escribible
 * directamente desde internet.
 */
export async function preguntarAlAsistente(pregunta: string): Promise<RespuestaAsistente> {
  const texto = pregunta.trim().slice(0, MAX_PREGUNTA)
  if (!texto) {
    return {
      intencion: 'desconocida',
      texto: 'Escribime tu consulta y te ayudo.',
      derivar: false,
    }
  }

  const respuesta = await obtenerAsistente().responder(texto)

  if (respuesta.derivar) {
    const admin = crearClienteAdmin()
    await admin.from('consultas_bot').insert({ pregunta: texto })
  }

  return respuesta
}
