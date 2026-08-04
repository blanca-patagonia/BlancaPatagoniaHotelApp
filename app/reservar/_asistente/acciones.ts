'use server'

import { headers } from 'next/headers'

import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerAsistente } from '@/lib/asistente'
import { ipDePeticion } from '@/lib/firma'
import type { RespuestaAsistente } from '@/lib/domain/asistente'

/** Largo máximo aceptado, para no guardar textos abusivos. */
const MAX_PREGUNTA = 500

/**
 * Tope de consultas registradas por IP y por minuto.
 *
 * Un huésped real hace unas pocas preguntas seguidas; un script hace cientos.
 * Pasado el tope el asistente **sigue respondiendo** —no se le corta el
 * servicio a nadie— pero deja de escribir en la base.
 */
const MAX_POR_MINUTO = 5

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
    const ip = ipDePeticion(await headers())

    // El conteo lo hace la base, que tiene el índice; la decisión, la app.
    const { data: recientes } = await admin.rpc('consultas_recientes_de_ip', {
      p_ip: ip,
      p_minutos: 1,
    })

    if (typeof recientes !== 'number' || recientes < MAX_POR_MINUTO) {
      await admin.from('consultas_bot').insert({ pregunta: texto, ip })
    }
  }

  return respuesta
}
