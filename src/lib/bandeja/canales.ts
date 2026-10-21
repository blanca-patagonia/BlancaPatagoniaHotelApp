import 'server-only'
import { obtenerProveedorEmail } from '@/lib/email'
import type { CanalBandeja } from '@/lib/domain/bandeja'
import { asuntoDeRespuesta } from '@/lib/domain/bandeja'

/**
 * Salida de la bandeja: cómo se le responde al huésped por cada canal.
 *
 * Mismo patrón que el resto de los adapters del sistema (ADR 0027): HTTP pelado,
 * sin SDK, credenciales en variables de entorno. Los endpoints y la forma de
 * cada pedido salen de los servicios de envío de Chatwoot
 * (`Whatsapp::Providers::WhatsappCloudService`, `Instagram::SendOnInstagramService`,
 * `Facebook::SendOnFacebookService`, `Telegram::SendOnTelegramService`).
 *
 * ── Por qué no hay simulador ─────────────────────────────────────────────────
 *
 * A diferencia del `EmailProvider`, acá un canal sin claves **no se ofrece**: la
 * caja de respuesta lo dice y no deja escribir. Un simulador que responda «ok»
 * haría creer que el huésped recibió algo que nunca salió (ADR 0018), y en una
 * conversación eso es peor que en un aviso: el huésped está esperando.
 */

/** Versión de la Graph API. Fija a propósito, igual que `lib/whatsapp`. */
const GRAPH = 'v21.0'
const TIMEOUT_MS = 10_000

export interface Destino {
  /** El id del huésped en el canal (wa_id, IGSID, PSID, chat_id, email). */
  externoContacto: string
  /** Sólo correo. */
  asunto?: string | null
  /** Sólo correo: el Message-ID del último correo del huésped, para hilar. */
  enRespuestaA?: string | null
}

export interface ResultadoEnvioCanal {
  ok: boolean
  /** Id del mensaje en el canal: con él se casan los avisos de entrega. */
  externoId?: string
  /** Motivo legible, en castellano cuando lo podemos traducir. */
  detalle?: string
}

export interface OpcionesEnvio {
  /** Instagram/Messenger fuera de las 24 h (ver `ventanaDeRespuesta`). */
  agenteHumano?: boolean
  /** Para la idempotencia del correo: el id de nuestra fila. */
  idInterno?: string
}

function env(nombre: string): string | undefined {
  const v = process.env[nombre]?.trim()
  return v ? v : undefined
}

/** Variables que necesita cada canal para RESPONDER. */
export const VARIABLES_CANAL: Record<CanalBandeja, readonly string[]> = {
  whatsapp: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
  instagram: ['INSTAGRAM_ACCESS_TOKEN'],
  messenger: ['MESSENGER_PAGE_TOKEN'],
  email: ['RESEND_API_KEY', 'EMAIL_FROM'],
  telegram: ['TELEGRAM_BOT_TOKEN'],
  web: [],
}

/** Variables que necesita cada canal para RECIBIR (el webhook). */
export const VARIABLES_ENTRADA: Record<CanalBandeja, readonly string[]> = {
  whatsapp: ['META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'],
  instagram: ['META_WEBHOOK_VERIFY_TOKEN'],
  messenger: ['META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'],
  email: ['RESEND_WEBHOOK_SECRET', 'RESEND_API_KEY'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'],
  web: [],
}

/** ¿El canal tiene lo necesario para responder? */
export function puedeEnviar(canal: CanalBandeja): boolean {
  if (canal === 'email' && process.env.EMAIL_PROVIDER?.trim() !== 'resend') return false
  return VARIABLES_CANAL[canal].every((v) => env(v))
}

/**
 * ¿El canal puede recibir? Instagram acepta su propio secreto o el de la app de
 * Meta: una app «Instagram API with Instagram Login» tiene un secreto distinto
 * del de Facebook (Chatwoot verifica contra los dos).
 */
export function puedeRecibir(canal: CanalBandeja): boolean {
  if (canal === 'instagram' && !env('META_APP_SECRET') && !env('INSTAGRAM_APP_SECRET')) return false
  return VARIABLES_ENTRADA[canal].every((v) => env(v))
}

/** Error de la Graph API → texto. Los códigos que más se ven, traducidos. */
function errorDeMeta(cuerpo: unknown, status: number): string {
  const e = (cuerpo as { error?: { code?: number; error_subcode?: number; message?: string } })?.error
  const codigo = e?.code
  if (codigo === 190) return 'El token de Meta venció o fue revocado: hay que generar uno nuevo.'
  if (codigo === 131047 || e?.error_subcode === 2018278 || codigo === 10) {
    return 'Meta rechazó el mensaje porque pasaron más de 24 horas desde el último mensaje del huésped.'
  }
  if (codigo === 131026) return 'El número no tiene WhatsApp o no puede recibir mensajes.'
  if (codigo === 100) return `Meta rechazó el pedido: ${e?.message ?? 'parámetro inválido'}.`
  return `Meta respondió ${status}${codigo ? ` (código ${codigo})` : ''}: ${(e?.message ?? '').slice(0, 200)}`
}

async function postJson(
  url: string,
  cuerpo: unknown,
  cabeceras: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; datos: unknown }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabeceras },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const datos = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, datos }
}

async function enviarWhatsApp(d: Destino, texto: string): Promise<ResultadoEnvioCanal> {
  const { ok, status, datos } = await postJson(
    `https://graph.facebook.com/${GRAPH}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: d.externoContacto,
      type: 'text',
      // Sin vista previa: un enlace a la confirmación de reserva no tiene por
      // qué desplegar una tarjeta con datos del huésped.
      text: { body: texto, preview_url: false },
    },
    { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}` },
  )
  if (!ok) return { ok: false, detalle: errorDeMeta(datos, status) }
  return { ok: true, externoId: (datos as { messages?: { id?: string }[] }).messages?.[0]?.id }
}

/**
 * Instagram (API con inicio de sesión de Instagram) y Messenger (página de
 * Facebook) comparten la forma del pedido: `recipient` + `message`, y la
 * etiqueta HUMAN_AGENT para responder entre las 24 h y los 7 días.
 */
async function enviarMessengerPlatform(
  canal: 'instagram' | 'messenger',
  d: Destino,
  texto: string,
  op: OpcionesEnvio,
): Promise<ResultadoEnvioCanal> {
  const url =
    canal === 'instagram'
      ? `https://graph.instagram.com/${GRAPH}/${env('INSTAGRAM_ACCOUNT_ID') ?? 'me'}/messages`
      : `https://graph.facebook.com/${GRAPH}/me/messages`
  const token = canal === 'instagram' ? env('INSTAGRAM_ACCESS_TOKEN') : env('MESSENGER_PAGE_TOKEN')

  const { ok, status, datos } = await postJson(
    url,
    {
      recipient: { id: d.externoContacto },
      message: { text: texto },
      ...(op.agenteHumano
        ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }
        : { messaging_type: 'RESPONSE' }),
    },
    // El token va en la cabecera y no en la URL (Chatwoot lo pasa por query):
    // una URL termina en logs de proxies; una cabecera, no.
    { Authorization: `Bearer ${token}` },
  )
  if (!ok) return { ok: false, detalle: errorDeMeta(datos, status) }
  return { ok: true, externoId: (datos as { message_id?: string }).message_id }
}

async function enviarTelegram(d: Destino, texto: string): Promise<ResultadoEnvioCanal> {
  const { ok, datos } = await postJson(
    `https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`,
    { chat_id: d.externoContacto, text: texto },
  )
  const r = datos as { ok?: boolean; description?: string; result?: { message_id?: number } }
  if (!ok || !r.ok) {
    return {
      ok: false,
      detalle: r.description?.includes('blocked')
        ? 'El huésped bloqueó al bot de Telegram.'
        : `Telegram rechazó el mensaje: ${(r.description ?? 'sin detalle').slice(0, 200)}`,
    }
  }
  const id = r.result?.message_id
  // Mismo formato que la entrada (`tg:<chat>:<mensaje>`): son ids por chat.
  return { ok: true, externoId: id != null ? `tg:${d.externoContacto}:${id}` : undefined }
}

async function enviarCorreo(d: Destino, texto: string, op: OpcionesEnvio): Promise<ResultadoEnvioCanal> {
  const responderA = env('BANDEJA_EMAIL')
  const r = await obtenerProveedorEmail().enviar({
    para: d.externoContacto,
    asunto: asuntoDeRespuesta(d.asunto ?? null),
    cuerpo: texto,
    claveIdempotencia: op.idInterno ? `bandeja:${op.idInterno}` : undefined,
    cabeceras: d.enRespuestaA ? { 'In-Reply-To': d.enRespuestaA, References: d.enRespuestaA } : undefined,
    responderA,
  })
  return r.ok
    ? { ok: true, externoId: r.proveedorId ? `resend:${r.proveedorId}` : undefined }
    : { ok: false, detalle: r.detalle }
}

/**
 * Manda un texto por el canal. Nunca lanza: devuelve `{ ok: false, detalle }`
 * para que la bandeja deje el mensaje como `fallido` y se vea el motivo.
 */
export async function enviarPorCanal(
  canal: CanalBandeja,
  destino: Destino,
  texto: string,
  op: OpcionesEnvio = {},
): Promise<ResultadoEnvioCanal> {
  if (canal === 'web') return { ok: true }
  if (!puedeEnviar(canal)) {
    return { ok: false, detalle: `El canal no está configurado: faltan ${VARIABLES_CANAL[canal].join(', ')}.` }
  }
  try {
    switch (canal) {
      case 'whatsapp':
        return await enviarWhatsApp(destino, texto)
      case 'instagram':
      case 'messenger':
        return await enviarMessengerPlatform(canal, destino, texto, op)
      case 'telegram':
        return await enviarTelegram(destino, texto)
      case 'email':
        return await enviarCorreo(destino, texto, op)
    }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    return { ok: false, detalle: `No se pudo comunicar con el canal: ${motivo}` }
  }
}

/** El nombre de perfil de quien escribe por Instagram/Messenger (no viene en el webhook). */
export async function perfilMeta(
  canal: 'instagram' | 'messenger',
  id: string,
): Promise<string | undefined> {
  const token = canal === 'instagram' ? env('INSTAGRAM_ACCESS_TOKEN') : env('MESSENGER_PAGE_TOKEN')
  if (!token) return undefined
  const base = canal === 'instagram' ? 'https://graph.instagram.com' : 'https://graph.facebook.com'
  const campos = canal === 'instagram' ? 'name,username' : 'first_name,last_name'
  try {
    const r = await fetch(`${base}/${GRAPH}/${encodeURIComponent(id)}?fields=${campos}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!r.ok) return undefined
    const p = (await r.json()) as { name?: string; username?: string; first_name?: string; last_name?: string }
    return (
      p.name ||
      [p.first_name, p.last_name].filter(Boolean).join(' ') ||
      (p.username ? `@${p.username}` : undefined)
    )
  } catch {
    return undefined
  }
}
