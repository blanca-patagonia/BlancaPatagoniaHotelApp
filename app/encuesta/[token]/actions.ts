'use server'

import { redirect } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { puntajeValido } from '@/lib/domain/encuestas'

/**
 * Registra la respuesta de la encuesta de satisfacción.
 *
 * Sin cuenta: el token de la URL es la credencial, igual que en la confirmación
 * de reserva y en la firma de contratos. Se resuelve con `service_role`, de modo
 * que `anon` no necesita ninguna política sobre la tabla.
 */
export async function responderEncuesta(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  const puntaje = Number(formData.get('puntaje'))
  const comentario = String(formData.get('comentario') ?? '').trim().slice(0, 1000)

  if (!token) redirect('/')
  if (!puntajeValido(puntaje)) redirect(`/encuesta/${token}?error=puntaje`)

  const admin = crearClienteAdmin()
  const { data: encuesta } = await admin
    .from('encuestas_satisfaccion')
    .select('id, respondida_en')
    .eq('token', token)
    .maybeSingle()

  if (!encuesta) redirect(`/encuesta/${token}?error=invalida`)
  // Una sola respuesta por encuesta: si no, el NPS se podría inflar.
  if (encuesta.respondida_en) redirect(`/encuesta/${token}?ok=1`)

  await admin
    .from('encuestas_satisfaccion')
    .update({
      puntaje,
      comentario: comentario || null,
      respondida_en: new Date().toISOString(),
    })
    .eq('id', encuesta.id)

  redirect(`/encuesta/${token}?ok=1`)
}
