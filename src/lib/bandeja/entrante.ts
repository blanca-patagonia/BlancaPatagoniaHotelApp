import 'server-only'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { registrarError } from '@/lib/registro'
import { registrarFalla } from '@/lib/acciones'
import { esAvanceMensaje, type EstadoMensaje } from '@/lib/domain/bandeja'
import type { EntranteNormalizado, EstadoNormalizado, Interpretacion } from '@/lib/domain/bandeja-entrante'
import { perfilMeta } from './canales'
import { enviarMensajeAutomatico } from './automaticos'

/**
 * Entrada a la bandeja: lo que ya tradujo `lib/domain/bandeja-entrante.ts` se
 * guarda acá. Lo llaman los webhooks (con `service_role`, sin sesión) y el chat
 * de la web.
 */

export interface ResultadoEntrada {
  guardados: number
  duplicados: number
  ignorados: number
  estados: number
  /** Los que fallaron. El webhook responde 500 si hay alguno, para que reintenten. */
  fallidos: number
  /** Conversaciones tocadas, en orden. El chat de la web usa la primera. */
  conversaciones: string[]
}

interface RespuestaRpc {
  conversacion_id?: string
  mensaje_id?: string | null
  contacto_id?: string
  nueva?: boolean
  primera_vez?: boolean
  duplicado?: boolean
  ignorado?: string
}

/** Guarda UN mensaje entrante (o eco). */
export async function registrarEntrante(m: EntranteNormalizado): Promise<RespuestaRpc | null> {
  const admin = crearClienteAdmin()

  // Instagram y Messenger no mandan el nombre: se pide al perfil, sólo la
  // primera vez (si la identidad ya existe, el nombre ya está guardado). Si
  // falla, se guarda sin nombre: el mensaje importa más que cómo se llama.
  let nombre = m.nombre
  if (!nombre && m.tipo === 'entrante' && (m.canal === 'instagram' || m.canal === 'messenger')) {
    const { data: existe, error: eExiste } = await admin
      .from('crm_identidades')
      .select('id, crm_bandejas!inner(canal)')
      .eq('externo_id', m.externoContacto)
      .eq('crm_bandejas.canal', m.canal)
      .maybeSingle()
    // Si la lectura falla se sigue sin nombre: es un dato accesorio.
    registrarFalla(eExiste, 'bandeja:identidad_existente')
    if (!existe && !eExiste) nombre = await perfilMeta(m.canal, m.externoContacto)
  }

  const { data, error } = await admin.rpc('crm_registrar_entrante', {
    p_canal: m.canal,
    p_externo_contacto: m.externoContacto,
    p_nombre: nombre ?? null,
    p_email: m.email ?? null,
    p_telefono: m.telefono ?? null,
    p_externo_mensaje: m.externoMensaje,
    p_contenido: m.contenido,
    p_adjuntos: m.adjuntos,
    p_creado_en: m.creadoEn,
    p_tipo: m.tipo,
    p_asunto: m.asunto ?? null,
  })

  if (error) {
    // Sin el contenido del mensaje ni el teléfono en el registro: son datos
    // personales, y el registro de errores lo lee más gente que la bandeja.
    await registrarError('bandeja_entrada_fallo', { canal: m.canal, codigo: error.code, motivo: error.message })
    return null
  }
  return data as RespuestaRpc
}

/**
 * Aplica un aviso de entrega (enviado → entregado → leído, o fallido). Sólo
 * avanza: los avisos llegan desordenados (`esAvanceMensaje`).
 */
export async function aplicarEstado(e: EstadoNormalizado): Promise<boolean> {
  const admin = crearClienteAdmin()
  const { data: fila, error } = await admin
    .from('crm_mensajes')
    .select('id, estado')
    .eq('externo_id', e.externoMensaje)
    .maybeSingle<{ id: string; estado: EstadoMensaje }>()

  if (error) {
    await registrarError('bandeja_estado_lectura', { codigo: error.code, motivo: error.message })
    return false
  }
  // Sin fila: un mensaje que salió por otro camino (los avisos por plantilla de
  // `lib/whatsapp` usan el mismo número). No es un error.
  if (!fila || !esAvanceMensaje(fila.estado, e.estado)) return true

  const { error: eUpd } = await admin
    .from('crm_mensajes')
    .update({ estado: e.estado, ...(e.error ? { error: e.error } : {}) })
    .eq('id', fila.id)
  if (eUpd) {
    await registrarError('bandeja_estado_escritura', { codigo: eUpd.code, motivo: eUpd.message })
    return false
  }
  return true
}

/** Procesa todo lo que trajo un webhook. */
export async function procesarInterpretacion(i: Interpretacion): Promise<ResultadoEntrada> {
  const r: ResultadoEntrada = { guardados: 0, duplicados: 0, ignorados: 0, estados: 0, fallidos: 0, conversaciones: [] }

  // En orden, no en paralelo: dos mensajes del mismo huésped en el mismo lote
  // tienen que quedar en el orden en que los escribió.
  for (const m of i.mensajes) {
    const res = await registrarEntrante(m)
    if (!res) r.fallidos += 1
    else if (res.ignorado) r.ignorados += 1
    else if (res.duplicado) r.duplicados += 1
    else {
      r.guardados += 1
      // Saludo / fuera de horario: sólo para lo que escribió el huésped, no para un eco.
      if (m.tipo === 'entrante' && res.conversacion_id && res.contacto_id) {
        await enviarMensajeAutomatico({
          canal: m.canal,
          externoContacto: m.externoContacto,
          email: m.email,
          asunto: m.asunto,
          conversacionId: res.conversacion_id,
          contactoId: res.contacto_id,
          nueva: Boolean(res.nueva),
          primeraVez: Boolean(res.primera_vez),
        })
      }
    }
    if (res?.conversacion_id && !r.conversaciones.includes(res.conversacion_id)) {
      r.conversaciones.push(res.conversacion_id)
    }
  }

  for (const e of i.estados) {
    if (await aplicarEstado(e)) r.estados += 1
    else r.fallidos += 1
  }
  return r
}
