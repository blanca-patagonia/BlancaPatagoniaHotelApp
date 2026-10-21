/**
 * Traducción de lo que mandan los canales a un formato único (lógica pura).
 *
 * Cada canal describe el mismo hecho —«alguien escribió»— con una forma propia.
 * Esto los lleva a `EntranteNormalizado` / `EstadoNormalizado`, y a partir de
 * acá el resto del sistema no sabe de qué canal vino. Las formas salen de los
 * servicios de entrada de Chatwoot (`Whatsapp::IncomingMessageBaseService`,
 * `Webhooks::InstagramEventsJob`, `Integrations::Facebook::MessageParser`,
 * `Telegram::IncomingMessageService`) y de la documentación de cada API.
 *
 * ⚠️ Todo es defensivo: un webhook es entrada no confiable aunque esté firmado
 * (la firma dice QUIÉN lo manda, no que la forma sea la esperada). Lo que no se
 * entiende se descarta, nunca rompe el lote entero.
 */

import type { Adjunto, CanalBandeja, EstadoMensaje, TipoAdjunto } from './bandeja'
import { sinTextoCitado, textoDeHtml } from './bandeja'

export interface EntranteNormalizado {
  canal: CanalBandeja
  /** El id de quien escribe EN el canal (wa_id, IGSID, PSID, chat_id, email). */
  externoContacto: string
  nombre?: string
  email?: string
  telefono?: string
  /** El id del mensaje en el canal: la clave de idempotencia. */
  externoMensaje: string
  contenido: string
  adjuntos: Adjunto[]
  creadoEn: string
  /**
   * `saliente` = un «eco»: algo que el hotel mandó desde la app del teléfono
   * (WhatsApp Business, Instagram) y no desde el panel. Se guarda para que el
   * hilo esté completo; si salió del panel ya está y la clave lo descarta.
   */
  tipo: 'entrante' | 'saliente'
  asunto?: string
}

export interface EstadoNormalizado {
  externoMensaje: string
  estado: EstadoMensaje
  error?: string
}

export interface Interpretacion {
  mensajes: EntranteNormalizado[]
  estados: EstadoNormalizado[]
}

const VACIO: Interpretacion = { mensajes: [], estados: [] }

type Obj = Record<string, unknown>

function obj(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return undefined
}

/** Segundos (WhatsApp, Telegram) o milisegundos (Instagram, Messenger) → ISO. */
function instante(v: unknown, unidad: 's' | 'ms'): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString()
  return new Date(unidad === 's' ? n * 1000 : n).toISOString()
}

// ── WhatsApp Cloud API ───────────────────────────────────────────────────────

const ADJUNTO_WHATSAPP: Record<string, TipoAdjunto> = {
  image: 'imagen',
  audio: 'audio',
  voice: 'audio',
  video: 'video',
  document: 'archivo',
  sticker: 'sticker',
}

const ESTADO_WHATSAPP: Record<string, EstadoMensaje> = {
  sent: 'enviado',
  delivered: 'entregado',
  read: 'leido',
  failed: 'fallido',
}

/**
 * El texto de un mensaje de WhatsApp según su tipo. Los botones y las listas
 * traen lo que el huésped TOCÓ, que es su respuesta.
 */
function textoWhatsApp(m: Obj): string {
  const tipo = str(m.type)
  if (tipo === 'text') return str(obj(m.text)?.body) ?? ''
  if (tipo === 'button') return str(obj(m.button)?.text) ?? ''
  if (tipo === 'interactive') {
    const i = obj(m.interactive)
    return str(obj(i?.button_reply)?.title) ?? str(obj(i?.list_reply)?.title) ?? ''
  }
  if (tipo === 'reaction') return str(obj(m.reaction)?.emoji) ?? ''
  if (tipo && ADJUNTO_WHATSAPP[tipo]) return str(obj(m[tipo])?.caption) ?? ''
  if (tipo === 'location') {
    const l = obj(m.location)
    const nombre = [str(l?.name), str(l?.address)].filter(Boolean).join(' — ')
    return nombre || 'Ubicación compartida'
  }
  if (tipo === 'contacts') {
    const c = obj(arr(m.contacts)[0])
    return `Contacto: ${str(obj(c?.name)?.formatted_name) ?? 'sin nombre'}`
  }
  // Tipos que WhatsApp no sabe mostrar (el campo `errors` lo explica).
  return '[Mensaje que WhatsApp no permite ver desde la API]'
}

function adjuntosWhatsApp(m: Obj): Adjunto[] {
  const tipo = str(m.type)
  if (tipo === 'location') {
    const l = obj(m.location)
    const lat = Number(l?.latitude)
    const lon = Number(l?.longitude)
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return [{ tipo: 'ubicacion', url: `https://www.google.com/maps?q=${lat},${lon}` }]
    }
    return [{ tipo: 'ubicacion' }]
  }
  if (tipo === 'contacts') return [{ tipo: 'contacto' }]
  const a = tipo ? ADJUNTO_WHATSAPP[tipo] : undefined
  if (!a) return []
  const datos = obj(m[tipo as string])
  // WhatsApp NO manda la URL: manda un id de medio que se baja con el token, y
  // esa URL vence en minutos. Se guarda el id en el nombre para poder pedirlo
  // después (ver ADR 0043, «adjuntos»).
  return [{ tipo: a, nombre: str(datos?.filename) ?? (str(datos?.id) ? `media:${str(datos?.id)}` : undefined), mime: str(datos?.mime_type) }]
}

/**
 * Webhook de WhatsApp Cloud: `entry[].changes[].value` con `messages`,
 * `statuses` y —desde la coexistencia con la app— `message_echoes`.
 */
export function interpretarWhatsApp(payload: unknown): Interpretacion {
  const raiz = obj(payload)
  if (!raiz || str(raiz.object) !== 'whatsapp_business_account') return VACIO

  const resultado: Interpretacion = { mensajes: [], estados: [] }

  for (const entry of arr(raiz.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const value = obj(obj(change)?.value)
      if (!value) continue

      // Nombre de perfil por wa_id (viene aparte de los mensajes).
      const nombres = new Map<string, string>()
      for (const c of arr(value.contacts)) {
        const wa = str(obj(c)?.wa_id)
        const nombre = str(obj(obj(c)?.profile)?.name)
        if (wa && nombre) nombres.set(wa, nombre)
      }

      for (const crudo of arr(value.messages)) {
        const m = obj(crudo)
        const de = str(m?.from)
        const id = str(m?.id)
        if (!m || !de || !id) continue
        resultado.mensajes.push({
          canal: 'whatsapp',
          externoContacto: de,
          nombre: nombres.get(de),
          telefono: `+${de}`,
          externoMensaje: id,
          contenido: textoWhatsApp(m),
          adjuntos: adjuntosWhatsApp(m),
          creadoEn: instante(m.timestamp, 's'),
          tipo: 'entrante',
        })
      }

      // Ecos: lo que el hotel escribió desde la app de WhatsApp Business.
      for (const crudo of arr(value.message_echoes)) {
        const m = obj(crudo)
        const para = str(m?.to)
        const id = str(m?.id)
        if (!m || !para || !id) continue
        resultado.mensajes.push({
          canal: 'whatsapp',
          externoContacto: para,
          telefono: `+${para}`,
          externoMensaje: id,
          contenido: textoWhatsApp(m),
          adjuntos: adjuntosWhatsApp(m),
          creadoEn: instante(m.timestamp, 's'),
          tipo: 'saliente',
        })
      }

      for (const crudo of arr(value.statuses)) {
        const s = obj(crudo)
        const id = str(s?.id)
        const estado = ESTADO_WHATSAPP[str(s?.status) ?? '']
        if (!id || !estado) continue
        const err = obj(arr(s?.errors)[0])
        resultado.estados.push({
          externoMensaje: id,
          estado,
          error: err ? `${str(err.code) ?? ''} ${str(err.title) ?? str(err.message) ?? ''}`.trim() : undefined,
        })
      }
    }
  }
  return resultado
}

// ── Instagram y Messenger (misma Messenger Platform) ─────────────────────────

const ADJUNTO_META: Record<string, TipoAdjunto> = {
  image: 'imagen',
  audio: 'audio',
  video: 'video',
  file: 'archivo',
  location: 'ubicacion',
  story_mention: 'imagen',
  share: 'archivo',
  ig_reel: 'video',
  reel: 'video',
}

/**
 * Webhook de Instagram (`object: "instagram"`) o de una página de Facebook
 * (`object: "page"`). Los dos traen `entry[].messaging[]` con `sender`,
 * `recipient`, `message` (o `delivery` / `read`).
 *
 * `cuentaPropia`: el id de la cuenta del hotel. En un eco (`is_echo`) el
 * remitente es el hotel y el huésped es el destinatario; sin saber cuál es la
 * cuenta propia no se puede distinguir de qué lado está cada uno.
 */
export function interpretarMensajeriaMeta(payload: unknown, cuentaPropia?: string): Interpretacion {
  const raiz = obj(payload)
  const objeto = str(raiz?.object)
  if (!raiz || (objeto !== 'instagram' && objeto !== 'page')) return VACIO
  const canal: CanalBandeja = objeto === 'instagram' ? 'instagram' : 'messenger'

  const resultado: Interpretacion = { mensajes: [], estados: [] }

  for (const entry of arr(raiz.entry)) {
    const e = obj(entry)
    // `standby` = eventos cuando otra app tiene el control del hilo (handover).
    for (const crudo of [...arr(e?.messaging), ...arr(e?.standby)]) {
      const ev = obj(crudo)
      if (!ev) continue
      const remitente = str(obj(ev.sender)?.id)
      const destinatario = str(obj(ev.recipient)?.id)
      const mensaje = obj(ev.message)

      if (mensaje) {
        const mid = str(mensaje.mid)
        if (!mid || !remitente || !destinatario) continue
        // Un mensaje que el huésped borró no tiene nada que mostrar.
        if (mensaje.is_deleted === true) continue

        const eco = mensaje.is_echo === true || (cuentaPropia != null && remitente === cuentaPropia)
        const adjuntos: Adjunto[] = arr(mensaje.attachments).flatMap((a) => {
          const o = obj(a)
          const tipo = ADJUNTO_META[str(o?.type) ?? '']
          if (!tipo) return []
          const url = str(obj(o?.payload)?.url)
          return [{ tipo, url: url && /^https:\/\//.test(url) ? url : undefined }]
        })

        resultado.mensajes.push({
          canal,
          externoContacto: eco ? destinatario : remitente,
          externoMensaje: mid,
          contenido: str(mensaje.text) ?? '',
          adjuntos,
          creadoEn: instante(ev.timestamp, 'ms'),
          tipo: eco ? 'saliente' : 'entrante',
        })
        continue
      }

      // Messenger informa entregas por lista de mids; Instagram, lecturas por mid.
      for (const mid of arr(obj(ev.delivery)?.mids)) {
        const id = str(mid)
        if (id) resultado.estados.push({ externoMensaje: id, estado: 'entregado' })
      }
      const leido = str(obj(ev.read)?.mid)
      if (leido) resultado.estados.push({ externoMensaje: leido, estado: 'leido' })
    }
  }
  return resultado
}

// ── Telegram ─────────────────────────────────────────────────────────────────

/**
 * Un `Update` de la Bot API. Sólo chats privados: un bot agregado a un grupo
 * recibiría lo que escribe cualquiera del grupo, y eso no es un huésped.
 */
export function interpretarTelegram(update: unknown): Interpretacion {
  const u = obj(update)
  const m = obj(u?.message) ?? obj(u?.edited_message)
  if (!m) return VACIO
  const chat = obj(m.chat)
  if (str(chat?.type) !== 'private') return VACIO

  const chatId = str(chat?.id)
  const mensajeId = str(m.message_id)
  if (!chatId || !mensajeId) return VACIO

  const de = obj(m.from)
  const nombre = [str(de?.first_name), str(de?.last_name)].filter(Boolean).join(' ').trim()

  const adjuntos: Adjunto[] = []
  if (arr(m.photo).length > 0) adjuntos.push({ tipo: 'imagen' })
  if (obj(m.voice) || obj(m.audio)) adjuntos.push({ tipo: 'audio' })
  if (obj(m.video) || obj(m.video_note)) adjuntos.push({ tipo: 'video' })
  if (obj(m.document)) adjuntos.push({ tipo: 'archivo', nombre: str(obj(m.document)?.file_name) })
  if (obj(m.sticker)) adjuntos.push({ tipo: 'sticker' })
  if (obj(m.location)) {
    const l = obj(m.location)
    adjuntos.push({ tipo: 'ubicacion', url: `https://www.google.com/maps?q=${str(l?.latitude)},${str(l?.longitude)}` })
  }
  const contacto = obj(m.contact)
  if (contacto) adjuntos.push({ tipo: 'contacto' })

  return {
    mensajes: [{
      canal: 'telegram',
      externoContacto: chatId,
      nombre: nombre || (str(de?.username) ? `@${str(de?.username)}` : undefined),
      // Si el huésped comparte SU contacto, trae su teléfono: sirve para vincularlo.
      telefono: contacto && str(contacto.user_id) === str(de?.id) ? str(contacto.phone_number) : undefined,
      // El message_id de Telegram es único POR CHAT, no global: se le antepone el
      // chat para que la clave de idempotencia no choque entre huéspedes.
      externoMensaje: `tg:${chatId}:${mensajeId}`,
      contenido: str(m.text) ?? str(m.caption) ?? '',
      adjuntos,
      creadoEn: instante(m.date, 's'),
      tipo: 'entrante',
    }],
    estados: [],
  }
}

// ── Correo recibido (Resend Inbound) ─────────────────────────────────────────

/** «Nombre <correo@x>» → partes. */
export function separarRemitente(de: string): { nombre?: string; email?: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(de)
  if (m) return { nombre: m[1].trim() || undefined, email: m[2].trim().toLowerCase() }
  const solo = de.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+$/.test(solo) ? { email: solo } : {}
}

/** El HTML de Resend puede venir como `data:` URI (`html_format: data_uri`). */
function htmlPlano(html: string): string {
  const m = /^data:[^,]*?(;base64)?,([\s\S]*)$/.exec(html)
  if (!m) return html
  try {
    // `atob` + `TextDecoder` y no `Buffer`: el dominio no depende de Node.
    return m[1]
      ? new TextDecoder().decode(Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0)))
      : decodeURIComponent(m[2])
  } catch {
    return ''
  }
}

/**
 * El correo completo que devuelve `GET /emails/receiving/{id}`.
 *
 * `cuentaPropia`: la dirección del hotel. Un correo que viene DESDE ahí es
 * nuestro (un reenvío, una copia) y no se carga como mensaje de un huésped.
 */
export function interpretarCorreoRecibido(correo: unknown, cuentaPropia?: string): Interpretacion {
  const c = obj(correo)
  if (!c) return VACIO

  const cabeceras = obj(c.headers)
  const remitente = separarRemitente(str(cabeceras?.from) ?? str(c.from) ?? '')
  const email = remitente.email
  if (!email) return VACIO
  if (cuentaPropia && email === separarRemitente(cuentaPropia).email) return VACIO

  const crudo = str(c.text) ?? (str(c.html) ? textoDeHtml(htmlPlano(str(c.html) as string)) : '')
  const idMensaje = str(c.message_id) ?? (str(c.id) ? `resend:${str(c.id)}` : undefined)
  if (!idMensaje) return VACIO

  const adjuntos: Adjunto[] = arr(c.attachments).flatMap((a) => {
    const o = obj(a)
    // Las imágenes «inline» son firmas y logos del cliente de correo, no algo
    // que el huésped haya querido mandar.
    if (!o || str(o.content_disposition) === 'inline') return []
    const mime = str(o.content_type) ?? ''
    return [{ tipo: mime.startsWith('image/') ? 'imagen' : 'archivo', nombre: str(o.filename), mime } as Adjunto]
  })

  return {
    mensajes: [{
      canal: 'email',
      externoContacto: email,
      nombre: remitente.nombre,
      email,
      externoMensaje: idMensaje,
      contenido: sinTextoCitado(crudo),
      adjuntos,
      creadoEn: str(c.created_at) ?? new Date().toISOString(),
      tipo: 'entrante',
      asunto: str(c.subject),
    }],
    estados: [],
  }
}
