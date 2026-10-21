import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { ventanaDeRespuesta, type CanalBandeja } from '@/lib/domain/bandeja'
import { enviarPorCanal, puedeEnviar } from './canales'

/**
 * Responder desde la bandeja (ADR 0043).
 *
 * El orden importa y es el de Chatwoot (`SendReplyJob`): primero se GUARDA el
 * mensaje como `pendiente`, después se llama al canal, y al final se anota el
 * resultado. Al revés —mandar y después guardar— un fallo de la base dejaría
 * un mensaje que el huésped recibió y que nadie del hotel ve.
 *
 * Usa el cliente del USUARIO, no el de servicio: RLS exige que el mensaje vaya
 * a nombre de quien lo escribe (`autor_id = auth.uid()`), así nadie puede
 * responder como otra persona.
 */

export type ResultadoResponder = { ok: true; aviso?: string } | { error: string }

interface FilaConversacion {
  id: string
  asunto: string | null
  ultimo_entrante_en: string | null
  asignada_a: string | null
  crm_bandejas: { canal: CanalBandeja; activa: boolean }
  crm_identidades: { externo_id: string }
  crm_contactos: { email: string | null; bloqueado: boolean }
}

export async function responderConversacion(
  autorId: string,
  conversacionId: string,
  texto: string,
  modo: 'respuesta' | 'nota',
): Promise<ResultadoResponder> {
  const contenido = texto.trim()
  if (!contenido) return { error: 'Escribí el mensaje.' }
  const supabase = await crearClienteServidor()
  if (contenido.length > 4000) return { error: 'El mensaje es demasiado largo (máximo 4000 caracteres).' }

  if (modo === 'nota') {
    const { error } = await supabase
      .from('crm_mensajes')
      .insert({ conversacion_id: conversacionId, tipo: 'nota', contenido, autor_id: autorId })
    if (error) {
      registrarFalla(error, 'bandeja:nota')
      return { error: 'No se pudo guardar la nota. Probá de nuevo.' }
    }
    return { ok: true }
  }

  const { data: conv, error: eConv } = await supabase
    .from('crm_conversaciones')
    .select(
      'id, asunto, ultimo_entrante_en, asignada_a, crm_bandejas!inner(canal, activa), crm_identidades!inner(externo_id), crm_contactos!inner(email, bloqueado)',
    )
    .eq('id', conversacionId)
    .maybeSingle<FilaConversacion>()

  if (eConv) {
    registrarFalla(eConv, 'bandeja:responder:lectura')
    return { error: 'No se pudo leer la conversación. Probá de nuevo.' }
  }
  if (!conv) return { error: 'La conversación no existe o no tenés acceso.' }

  const canal = conv.crm_bandejas.canal
  if (conv.crm_contactos.bloqueado) return { error: 'El contacto está bloqueado: desbloquealo para responder.' }
  if (!puedeEnviar(canal)) {
    return { error: 'Este canal todavía no tiene sus claves cargadas, así que no se puede responder desde acá. Mirá Configuración → Integraciones.' }
  }

  const ventana = ventanaDeRespuesta(canal, conv.ultimo_entrante_en, new Date(), {
    agenteHumano: process.env.META_HUMAN_AGENT?.trim() === '1',
  })
  if (!ventana.abierta) return { error: ventana.motivo ?? 'No se puede responder por este canal ahora.' }

  // Para hilar el correo: el Message-ID del último correo del huésped.
  let enRespuestaA: string | null = null
  if (canal === 'email') {
    const { data: ultimo, error: eUlt } = await supabase
      .from('crm_mensajes')
      .select('externo_id')
      .eq('conversacion_id', conversacionId)
      .eq('tipo', 'entrante')
      .not('externo_id', 'is', null)
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle<{ externo_id: string }>()
    // Sin el id, el correo sale igual: llega como hilo nuevo en vez de respuesta.
    registrarFalla(eUlt, 'bandeja:responder:hilo_correo')
    enRespuestaA = ultimo?.externo_id?.startsWith('<') ? ultimo.externo_id : null
  }

  const { data: fila, error: eIns } = await supabase
    .from('crm_mensajes')
    .insert({
      conversacion_id: conversacionId,
      tipo: 'saliente',
      contenido,
      autor_id: autorId,
      estado: canal === 'web' ? 'enviado' : 'pendiente',
    })
    .select('id')
    .single<{ id: string }>()

  if (eIns) {
    registrarFalla(eIns, 'bandeja:responder:insertar')
    return { error: 'No se pudo guardar la respuesta. No se envió nada.' }
  }

  // Como en Chatwoot: quien responde una conversación sin asignar se la queda.
  if (!conv.asignada_a) {
    const { error: eAsig } = await supabase
      .from('crm_conversaciones')
      .update({ asignada_a: autorId })
      .eq('id', conversacionId)
      .is('asignada_a', null)
    registrarFalla(eAsig, 'bandeja:responder:autoasignar')
  }

  if (canal === 'web') {
    /*
      El visitante del chat web probablemente ya cerró la página: la respuesta
      queda en el chat y además le llega por correo (Chatwoot: «conversation
      continuity via email»). Si el correo no está configurado o falla, la
      respuesta igual quedó en el chat; se avisa, no se corta.
    */
    const email = conv.crm_contactos.email
    if (!email || !puedeEnviar('email')) {
      return { ok: true, aviso: email ? 'Quedó en el chat de la web. El correo no está configurado, así que no le llegó copia por email.' : undefined }
    }
    const copia = await enviarPorCanal(
      'email',
      { externoContacto: email, asunto: 'Tu consulta en Blanca Patagonia' },
      `${contenido}\n\n—\nRecepción de Blanca Patagonia. Podés responder este correo o seguir la conversación en el chat de la web.`,
      { idInterno: fila.id },
    )
    return copia.ok ? { ok: true } : { ok: true, aviso: `Quedó en el chat de la web, pero no se pudo mandar la copia por correo: ${copia.detalle ?? ''}` }
  }

  const envio = await enviarPorCanal(
    canal,
    { externoContacto: conv.crm_identidades.externo_id, asunto: conv.asunto, enRespuestaA },
    contenido,
    { agenteHumano: ventana.agenteHumano, idInterno: fila.id },
  )

  const { error: eEstado } = await supabase
    .from('crm_mensajes')
    .update(
      envio.ok
        ? { estado: 'enviado', externo_id: envio.externoId ?? null }
        : { estado: 'fallido', error: envio.detalle ?? 'No se pudo enviar.' },
    )
    .eq('id', fila.id)

  if (eEstado) {
    /*
      El mensaje salió (o no) pero no se pudo anotar el resultado. Se avisa: con
      el estado en «enviando» para siempre, quien atiende no sabe si llegó.
      Si salió, el aviso de entrega del canal lo va a corregir solo cuando llegue
      … salvo que no se haya guardado el id, que es justo este caso.
    */
    registrarFalla(eEstado, 'bandeja:responder:resultado')
    return envio.ok
      ? { ok: true, aviso: 'El mensaje salió, pero no se pudo actualizar su estado en pantalla.' }
      : { error: envio.detalle ?? 'No se pudo enviar.' }
  }

  return envio.ok ? { ok: true } : { error: envio.detalle ?? 'No se pudo enviar.' }
}
