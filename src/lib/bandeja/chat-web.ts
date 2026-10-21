import 'server-only'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { registrarFalla } from '@/lib/acciones'
import { procesarInterpretacion } from './entrante'

/**
 * Chat de la web con recepción (canal `web` de la bandeja, ADR 0043).
 *
 * Es el «web widget» de Chatwoot, reducido a lo que el hotel necesita: el
 * visitante deja nombre, email y mensaje; recepción contesta desde la bandeja y
 * el visitante lo ve en la misma ventanita.
 *
 * ── La identidad del visitante es un token en una cookie httpOnly ────────────
 *
 * Chatwoot usa un `pubsub_token` en localStorage. Acá va en una cookie que el
 * JavaScript de la página NO puede leer: quien tenga el token lee la
 * conversación, y una extensión del navegador o un script inyectado no debería
 * poder llevárselo. Todo pasa por Server Actions con `service_role`; `anon`
 * no tiene ningún permiso sobre las tablas `crm_*`.
 */

export const COOKIE_CHAT = 'bp_chat_recepcion'

export interface MensajeChatWeb {
  id: string
  de: 'visitante' | 'hotel'
  texto: string
  creadoEn: string
}

export function nuevoToken(): string {
  return crypto.randomUUID()
}

export function tokenValido(t: string | undefined): t is string {
  return Boolean(t && /^[0-9a-f-]{36}$/i.test(t))
}

/** Guarda un mensaje del visitante (y dispara el saludo, si la bandeja lo tiene). */
export async function mensajeDelVisitante(
  token: string,
  texto: string,
  datos: { nombre?: string; email?: string } = {},
): Promise<boolean> {
  const r = await procesarInterpretacion({
    mensajes: [
      {
        canal: 'web',
        externoContacto: token,
        nombre: datos.nombre,
        email: datos.email,
        externoMensaje: `web:${crypto.randomUUID()}`,
        contenido: texto,
        adjuntos: [],
        creadoEn: new Date().toISOString(),
        tipo: 'entrante',
      },
    ],
    estados: [],
  })
  return r.guardados > 0 && r.fallidos === 0
}

/**
 * La conversación del visitante: sólo entrantes y salientes. Las notas privadas
 * y las actividades del staff NUNCA salen de acá — son la razón de que esto lea
 * con un filtro explícito y no «todo lo de la conversación».
 */
export async function leerChat(token: string): Promise<MensajeChatWeb[] | null> {
  const admin = crearClienteAdmin()
  const { data: identidad, error } = await admin
    .from('crm_identidades')
    .select('id, crm_bandejas!inner(canal)')
    .eq('externo_id', token)
    .eq('crm_bandejas.canal', 'web')
    .maybeSingle<{ id: string }>()
  if (error) {
    registrarFalla(error, 'chat_web:identidad')
    return null
  }
  if (!identidad) return []

  const { data: convs, error: eConv } = await admin
    .from('crm_conversaciones')
    .select('id')
    .eq('identidad_id', identidad.id)
  if (eConv) {
    registrarFalla(eConv, 'chat_web:conversaciones')
    return null
  }
  const ids = (convs ?? []).map((c) => c.id as string)
  if (ids.length === 0) return []

  const { data: ms, error: eMs } = await admin
    .from('crm_mensajes')
    .select('id, tipo, contenido, creado_en')
    .in('conversacion_id', ids)
    .in('tipo', ['entrante', 'saliente'])
    .order('creado_en', { ascending: true })
    .limit(200)
  if (eMs) {
    registrarFalla(eMs, 'chat_web:mensajes')
    return null
  }
  return (ms ?? []).map((m) => ({
    id: m.id as string,
    de: m.tipo === 'entrante' ? 'visitante' : 'hotel',
    texto: m.contenido as string,
    creadoEn: m.creado_en as string,
  }))
}
