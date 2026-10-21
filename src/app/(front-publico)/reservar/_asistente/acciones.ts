'use server'

import { headers } from 'next/headers'

import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerAsistente } from '@/lib/asistente'
import { ipDeCabeceras } from '@/lib/limites'
import type { RespuestaAsistente } from '@/lib/domain/asistente'
import { registrarFalla } from '@/lib/acciones'

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
    const ip = ipDeCabeceras(await headers())

    // El conteo lo hace la base, que tiene el índice; la decisión, la app.
    const { data: recientes, error: eRecientes } = await admin.rpc('consultas_recientes_de_ip', {
      p_ip: ip,
      p_minutos: 1,
    })
    // Si el conteo falla se registra la consulta igual (`recientes` no es un
    // número), como en el resto de los límites (`lib/limites.ts`): un contador
    // roto no le corta nada a un huésped. Pero tiene que quedar a la vista,
    // porque mientras dure el tope no actúa.
    registrarFalla(eRecientes, 'asistente_publico:conteo_de_consultas')

    if (typeof recientes !== 'number' || recientes < MAX_POR_MINUTO) {
      const { error } = await admin.from('consultas_bot').insert({ pregunta: texto, ip })
      // Se loguea y NO se corta, a propósito: esto es el REGISTRO de la consulta,
      // no la respuesta al huésped, que ya está calculada y se devuelve igual.
      // El ADR 0011 fijó que pasado el límite «sigue respondiendo y deja de
      // registrar»; cortarle la respuesta a un huésped real porque no se pudo
      // guardar el log sería el intercambio equivocado. Queda explícito acá para
      // que no parezca un descuido, que es como se veía antes.
      registrarFalla(error, 'registro de una consulta del asistente público')
    }
  }

  return respuesta
}
