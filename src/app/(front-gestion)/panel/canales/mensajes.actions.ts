'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cortarSiFalla } from '@/lib/acciones'
import { requerirAcceso } from '@/lib/auth/session'

/** Mensajes del huésped que llegan por el canal: cargarlos y marcarlos atendidos. */

const DESTINO = '/panel/canales'

/* ─────────────────────────────────────────────── mensajes y reseñas ──── */

/** Marca un mensaje del huésped como atendido. */
export async function marcarMensajeAtendido(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('canales')

  const id = String(formData.get('mensaje_id') ?? '')
  const atendido = String(formData.get('atendido') ?? '') === 'true'
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_mensajes')
    .update({
      atendido: !atendido,
      atendido_por: !atendido ? sesion.userId : null,
    })
    .eq('id', id)

  cortarSiFalla(error, `${DESTINO}?vista=mensajes`, 'mensaje')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=mensajes`)
}

/**
 * Carga a mano un mensaje o petición que llegó por el canal.
 *
 * Es manual porque **ni el CSV ni el iCal traen los mensajes**: eso requiere la
 * API de mensajería de Booking, que va con la Connectivity API. Cargarlos a mano
 * igual sirve — un pedido de cuna sin atender termina siendo una queja en la
 * reseña, y tenerlo en el sistema es mejor que en la memoria de quien lo leyó.
 */
export async function cargarMensaje(formData: FormData): Promise<void> {
  await requerirAcceso('canales')

  const cuerpo = String(formData.get('cuerpo') ?? '').trim()
  if (!cuerpo) redirect(`${DESTINO}?vista=mensajes&error=cuerpo`)

  const entranteId = String(formData.get('entrante_id') ?? '')

  /*
    El autor sale del formulario en vez de estar fijado en `'huesped'`.

    El `check` de la base ya permitía `'hotel'` desde la migración 0038, pero el valor
    nunca se usaba: no había forma de registrar la respuesta del hotel, así que el
    módulo guardaba media conversación. Sin la respuesta, «mensaje sin atender» es la
    única información disponible, y no se puede saber qué se le contestó al huésped.
  */
  const autor = String(formData.get('autor') ?? 'huesped')
  if (autor !== 'huesped' && autor !== 'hotel') {
    redirect(`${DESTINO}?vista=mensajes&error=autor`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_mensajes').insert({
    canal: 'booking',
    cuerpo,
    autor,
    canal_reserva_id: entranteId || null,
    // Un mensaje que escribe el hotel nace atendido: es la respuesta, no un pedido
    // pendiente. Sin esto, responder aumentaría el contador de «sin atender».
    ...(autor === 'hotel' ? { atendido: true } : {}),
  })

  cortarSiFalla(error, `${DESTINO}?vista=mensajes`, 'mensaje')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=mensajes&ok=mensaje`)
}
