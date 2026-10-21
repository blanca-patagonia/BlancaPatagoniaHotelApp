/**
 * Conexión automática de los canales de mensajería (ADR 0044).
 *
 * Es lo que vuelve «sencillo» conectar WhatsApp, Instagram y Messenger: en vez de
 * que alguien entre al panel de Meta y pegue la URL del webhook, el sistema se la
 * dice a Meta por API, y después verifica que haya quedado bien.
 *
 * Las llamadas salen del servicio de Chatwoot (MIT) que hace lo mismo:
 *   · WhatsApp: `Whatsapp::WebhookSetupService` + `FacebookApiClient`
 *       POST /{waba}/subscribed_apps           → suscribe la app a la cuenta
 *       POST /{numero}  webhook_configuration  → `override_callback_uri` por número
 *   · Instagram: `Channel::Instagram#subscribe`
 *       POST /{cuenta}/subscribed_apps?subscribed_fields=…
 *
 * ⚠️ Dos cosas que NO están verificadas contra Meta real —no hay credenciales
 * en este entorno—:
 *   1. `POST /{app-id}/subscriptions` (el webhook A NIVEL DE LA APP para Instagram
 *      y Messenger). Está documentado por Meta y por varios tutoriales, pero no
 *      se pudo abrir la página de referencia oficial ni probarlo.
 *   2. Todo lo demás se probó contra los payloads documentados, no contra la API.
 * Si algo falla, el resultado trae el mensaje de Meta tal cual y la guía manual
 * (`docs/3-manuales/integraciones-y-bandeja.md`) sigue valiendo: es el mismo
 * resultado pegando la URL a mano.
 *
 * ⚠️ Este archivo NO importa nada, a propósito: lo carga también
 * `scripts/configurar-integraciones.mjs` con Node directo.
 */

type Entorno = Record<string, string | undefined>

export interface PasoConexion {
  titulo: string
  /** `null` = no se puede saber (falta un dato) o no aplica. */
  ok: boolean | null
  detalle: string
}

export interface ResultadoConexion {
  ok: boolean
  pasos: PasoConexion[]
}

const GRAPH = 'v21.0'
const TIMEOUT = 10_000

function v(env: Entorno, nombre: string): string | undefined {
  const x = env[nombre]?.trim()
  return x ? x : undefined
}

interface RespuestaHttp {
  ok: boolean
  status: number
  datos: unknown
}

async function http(url: string, init: RequestInit = {}): Promise<RespuestaHttp> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store' })
  const datos = await r.json().catch(() => null)
  return { ok: r.ok, status: r.status, datos }
}

function motivoMeta(r: RespuestaHttp): string {
  const e = (r.datos as { error?: { code?: number; message?: string; error_user_msg?: string } } | null)?.error
  if (e?.code === 190) return 'El token venció o fue revocado: generá uno nuevo.'
  if (e?.code === 10 || e?.code === 200) return `Al token le falta un permiso (${(e.message ?? '').slice(0, 140)}).`
  const texto = e?.error_user_msg ?? e?.message ?? ''
  if (/validate|callback|verification/i.test(texto)) {
    return `Meta no pudo verificar la URL del webhook: tiene que ser pública (https) y el sistema tiene que estar levantado. ${texto.slice(0, 140)}`
  }
  return `Meta respondió ${r.status}${texto ? `: ${texto.slice(0, 200)}` : ''}.`
}

/** Un paso que falló por un dato que falta, no por un error del proveedor. */
function falta(titulo: string, variables: string[]): PasoConexion {
  return { titulo, ok: null, detalle: `Falta cargar ${variables.join(' y ')}.` }
}

function tokenDeApp(env: Entorno): string | null {
  const id = v(env, 'META_APP_ID')
  const secreto = v(env, 'META_APP_SECRET')
  return id && secreto ? `${id}|${secreto}` : null
}

// ── Webhook A NIVEL DE LA APP (Instagram y Messenger) ───────────────────────

type ObjetoMeta = 'whatsapp_business_account' | 'instagram' | 'page'

const CAMPOS_APP: Record<ObjetoMeta, string> = {
  whatsapp_business_account: 'messages',
  instagram: 'messages,messaging_seen,message_reactions',
  page: 'messages,message_deliveries,message_reads',
}

async function registrarWebhookDeApp(env: Entorno, objeto: ObjetoMeta, url: string): Promise<PasoConexion> {
  const titulo = 'Decirle a Meta a dónde avisar (webhook de la app)'
  const token = tokenDeApp(env)
  const verificacion = v(env, 'META_WEBHOOK_VERIFY_TOKEN')
  if (!token || !verificacion) {
    return {
      titulo,
      ok: null,
      detalle: 'Falta META_APP_ID, META_APP_SECRET o META_WEBHOOK_VERIFY_TOKEN: pegá la URL a mano en el panel de la app de Meta.',
    }
  }
  const r = await http(`https://graph.facebook.com/${GRAPH}/${encodeURIComponent(v(env, 'META_APP_ID') as string)}/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      object: objeto,
      callback_url: url,
      verify_token: verificacion,
      fields: CAMPOS_APP[objeto],
      access_token: token,
    }),
  })
  return r.ok && (r.datos as { success?: boolean } | null)?.success !== false
    ? { titulo, ok: true, detalle: `Meta va a avisar a ${url}.` }
    : { titulo, ok: false, detalle: motivoMeta(r) }
}

async function estadoWebhookDeApp(env: Entorno, objeto: ObjetoMeta, url: string): Promise<PasoConexion> {
  const titulo = 'Meta tiene la URL de este sistema (webhook de la app)'
  const token = tokenDeApp(env)
  if (!token) return falta(titulo, ['META_APP_ID', 'META_APP_SECRET'])
  const r = await http(
    `https://graph.facebook.com/${GRAPH}/${encodeURIComponent(v(env, 'META_APP_ID') as string)}/subscriptions?access_token=${encodeURIComponent(token)}`,
  )
  if (!r.ok) return { titulo, ok: false, detalle: motivoMeta(r) }
  const lista = ((r.datos as { data?: { object?: string; callback_url?: string; active?: boolean }[] } | null)?.data ?? [])
  const mia = lista.find((s) => s.object === objeto)
  if (!mia) return { titulo, ok: false, detalle: 'La app todavía no tiene webhook para este canal. Apretá «Conectar».' }
  if (mia.callback_url !== url) {
    return { titulo, ok: false, detalle: `La app apunta a otra dirección (${mia.callback_url}). Apretá «Conectar» para corregirla.` }
  }
  return { titulo, ok: true, detalle: 'Está apuntando acá.' }
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

export async function conectarWhatsApp(env: Entorno, url: string): Promise<ResultadoConexion> {
  const token = v(env, 'WHATSAPP_TOKEN')
  const numero = v(env, 'WHATSAPP_PHONE_NUMBER_ID')
  const waba = v(env, 'WHATSAPP_BUSINESS_ACCOUNT_ID')
  const verificacion = v(env, 'META_WEBHOOK_VERIFY_TOKEN')
  const pasos: PasoConexion[] = []

  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // 1) La app se suscribe a la cuenta de WhatsApp Business: sin esto Meta no manda nada.
  if (!token || !waba) {
    pasos.push(falta('Suscribir la app a tu cuenta de WhatsApp Business', ['WHATSAPP_TOKEN', 'WHATSAPP_BUSINESS_ACCOUNT_ID']))
  } else {
    const r = await http(`https://graph.facebook.com/${GRAPH}/${encodeURIComponent(waba)}/subscribed_apps`, {
      method: 'POST',
      headers: cab,
      // `smb_message_echoes`: lo que el hotel escribe desde la app del teléfono.
      body: JSON.stringify({ subscribed_fields: ['messages', 'smb_message_echoes'] }),
    })
    pasos.push(
      r.ok
        ? { titulo: 'Suscribir la app a tu cuenta de WhatsApp Business', ok: true, detalle: 'Listo.' }
        : { titulo: 'Suscribir la app a tu cuenta de WhatsApp Business', ok: false, detalle: motivoMeta(r) },
    )
  }

  // 2) La URL del webhook, por número (`override_callback_uri`): así no hace falta
  //    entrar al panel de Meta, y tiene prioridad sobre la de toda la cuenta.
  if (!token || !numero || !verificacion) {
    pasos.push(falta('Decirle a Meta a dónde avisar', ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'META_WEBHOOK_VERIFY_TOKEN']))
  } else {
    const r = await http(`https://graph.facebook.com/${GRAPH}/${encodeURIComponent(numero)}`, {
      method: 'POST',
      headers: cab,
      body: JSON.stringify({ webhook_configuration: { override_callback_uri: url, verify_token: verificacion } }),
    })
    pasos.push(
      r.ok
        ? { titulo: 'Decirle a Meta a dónde avisar', ok: true, detalle: `Meta va a avisar a ${url}.` }
        : { titulo: 'Decirle a Meta a dónde avisar', ok: false, detalle: motivoMeta(r) },
    )
  }

  return { ok: pasos.every((p) => p.ok === true), pasos }
}

// ── Instagram ───────────────────────────────────────────────────────────────

export async function conectarInstagram(env: Entorno, url: string): Promise<ResultadoConexion> {
  const token = v(env, 'INSTAGRAM_ACCESS_TOKEN')
  const pasos: PasoConexion[] = [await registrarWebhookDeApp(env, 'instagram', url)]

  if (!token) {
    pasos.push(falta('Suscribir la cuenta de Instagram a los mensajes', ['INSTAGRAM_ACCESS_TOKEN']))
  } else {
    const cuenta = v(env, 'INSTAGRAM_ACCOUNT_ID') ?? 'me'
    const q = new URLSearchParams({ subscribed_fields: 'messages,message_reactions,messaging_seen', access_token: token })
    const r = await http(`https://graph.instagram.com/${GRAPH}/${encodeURIComponent(cuenta)}/subscribed_apps?${q}`, { method: 'POST' })
    pasos.push(
      r.ok
        ? { titulo: 'Suscribir la cuenta de Instagram a los mensajes', ok: true, detalle: 'Listo.' }
        : { titulo: 'Suscribir la cuenta de Instagram a los mensajes', ok: false, detalle: motivoMeta(r) },
    )
  }
  // Un paso «no se puede saber» no impide el éxito de los que sí se pudieron hacer.
  return { ok: pasos.some((p) => p.ok === true) && pasos.every((p) => p.ok !== false), pasos }
}

// ── Messenger ───────────────────────────────────────────────────────────────

export async function conectarMessenger(env: Entorno, url: string): Promise<ResultadoConexion> {
  const token = v(env, 'MESSENGER_PAGE_TOKEN')
  const pasos: PasoConexion[] = [await registrarWebhookDeApp(env, 'page', url)]

  if (!token) {
    pasos.push(falta('Suscribir la página a los mensajes', ['MESSENGER_PAGE_TOKEN']))
  } else {
    const pagina = v(env, 'MESSENGER_PAGE_ID') ?? 'me'
    const r = await http(`https://graph.facebook.com/${GRAPH}/${encodeURIComponent(pagina)}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ subscribed_fields: 'messages,message_deliveries,message_reads' }),
    })
    pasos.push(
      r.ok
        ? { titulo: 'Suscribir la página a los mensajes', ok: true, detalle: 'Listo.' }
        : { titulo: 'Suscribir la página a los mensajes', ok: false, detalle: motivoMeta(r) },
    )
  }
  return { ok: pasos.some((p) => p.ok === true) && pasos.every((p) => p.ok !== false), pasos }
}

// ── Correo (Resend): crear el webhook y obtener su secreto ──────────────────

const EVENTOS_CORREO = ['email.delivered', 'email.bounced', 'email.complained', 'email.opened', 'email.received']

export async function crearWebhookDeCorreo(
  env: Entorno,
  url: string,
): Promise<{ ok: boolean; detalle: string; secreto?: string }> {
  const clave = v(env, 'RESEND_API_KEY')
  if (!clave) return { ok: false, detalle: 'Falta RESEND_API_KEY.' }
  const r = await http('https://api.resend.com/webhooks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: url, events: EVENTOS_CORREO }),
  })
  const d = r.datos as { signing_secret?: string; message?: string } | null
  if (!r.ok || !d?.signing_secret) {
    return { ok: false, detalle: `Resend respondió ${r.status}${d?.message ? `: ${d.message}` : ''}.` }
  }
  return { ok: true, detalle: 'Webhook creado en Resend.', secreto: d.signing_secret }
}

// ── Verificación en vivo ────────────────────────────────────────────────────

export type CanalConectable = 'whatsapp' | 'instagram' | 'messenger' | 'telegram' | 'email'

/**
 * ¿Está realmente conectado? No mira si las variables están cargadas —eso ya lo
 * dice el catálogo— sino qué responde el proveedor: si la clave anda, si Meta
 * tiene la URL de este sistema y si la cuenta está suscripta.
 *
 * Existe porque «cargué las claves» y «me llegan los mensajes» son cosas
 * distintas, y la diferencia son tres pasos del lado de Meta que nadie ve.
 */
export async function verificarConexion(canal: CanalConectable, env: Entorno, urlWebhook: string): Promise<PasoConexion[]> {
  try {
    switch (canal) {
      case 'whatsapp': return await verificarWhatsApp(env, urlWebhook)
      case 'instagram': return await verificarInstagram(env, urlWebhook)
      case 'messenger': return await verificarMessenger(env, urlWebhook)
      case 'telegram': return await verificarTelegram(env, urlWebhook)
      case 'email': return await verificarCorreo(env)
    }
  } catch (e) {
    return [{ titulo: 'Consultar al proveedor', ok: false, detalle: e instanceof Error ? e.message : String(e) }]
  }
}

async function verificarWhatsApp(env: Entorno, url: string): Promise<PasoConexion[]> {
  const token = v(env, 'WHATSAPP_TOKEN')
  const numero = v(env, 'WHATSAPP_PHONE_NUMBER_ID')
  const waba = v(env, 'WHATSAPP_BUSINESS_ACCOUNT_ID')
  if (!token || !numero) return [falta('La clave y el número responden', ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'])]
  const cab = { Authorization: `Bearer ${token}` }

  const [numeroR, suscR] = await Promise.all([
    http(`https://graph.facebook.com/${GRAPH}/${encodeURIComponent(numero)}?fields=display_phone_number,verified_name,webhook_configuration`, { headers: cab }),
    waba ? http(`https://graph.facebook.com/${GRAPH}/${encodeURIComponent(waba)}/subscribed_apps`, { headers: cab }) : Promise.resolve(null),
  ])

  const pasos: PasoConexion[] = []
  if (!numeroR.ok) return [{ titulo: 'La clave y el número responden', ok: false, detalle: motivoMeta(numeroR) }]
  const d = numeroR.datos as { display_phone_number?: string; verified_name?: string; webhook_configuration?: Record<string, string> }
  pasos.push({ titulo: 'La clave y el número responden', ok: true, detalle: `${d.display_phone_number ?? '?'} (${d.verified_name ?? 'sin nombre verificado'}).` })

  const cfg = d.webhook_configuration ?? {}
  const apunta = ['override_callback_uri', 'phone_number', 'whatsapp_business_account', 'application'].some((k) => cfg[k] === url)
  pasos.push({
    titulo: 'Meta tiene la URL de este sistema',
    ok: apunta,
    detalle: apunta ? 'Está apuntando acá.' : 'Meta no tiene esta dirección para el número. Apretá «Conectar».',
  })

  if (!suscR) pasos.push(falta('La app está suscripta a la cuenta', ['WHATSAPP_BUSINESS_ACCOUNT_ID']))
  else {
    const hay = suscR.ok && ((suscR.datos as { data?: unknown[] } | null)?.data ?? []).length > 0
    pasos.push({
      titulo: 'La app está suscripta a la cuenta',
      ok: hay,
      detalle: hay ? 'Sí.' : suscR.ok ? 'No: Meta no manda mensajes hasta que se suscriba. Apretá «Conectar».' : motivoMeta(suscR),
    })
  }
  return pasos
}

async function verificarInstagram(env: Entorno, url: string): Promise<PasoConexion[]> {
  const token = v(env, 'INSTAGRAM_ACCESS_TOKEN')
  if (!token) return [falta('La clave responde', ['INSTAGRAM_ACCESS_TOKEN'])]
  const cuenta = v(env, 'INSTAGRAM_ACCOUNT_ID') ?? 'me'
  const q = `access_token=${encodeURIComponent(token)}`

  const [yo, susc, app] = await Promise.all([
    http(`https://graph.instagram.com/${GRAPH}/me?fields=user_id,username&${q}`),
    http(`https://graph.instagram.com/${GRAPH}/${encodeURIComponent(cuenta)}/subscribed_apps?${q}`),
    estadoWebhookDeApp(env, 'instagram', url),
  ])
  const pasos: PasoConexion[] = []
  pasos.push(
    yo.ok
      ? { titulo: 'La clave responde', ok: true, detalle: `Cuenta @${(yo.datos as { username?: string })?.username ?? '?'}.` }
      : { titulo: 'La clave responde', ok: false, detalle: motivoMeta(yo) },
  )
  const hay = susc.ok && ((susc.datos as { data?: unknown[] } | null)?.data ?? []).length > 0
  pasos.push({
    titulo: 'La cuenta está suscripta a los mensajes',
    ok: susc.ok ? hay : false,
    detalle: !susc.ok ? motivoMeta(susc) : hay ? 'Sí.' : 'No. Apretá «Conectar».',
  })
  pasos.push(app)
  return pasos
}

async function verificarMessenger(env: Entorno, url: string): Promise<PasoConexion[]> {
  const token = v(env, 'MESSENGER_PAGE_TOKEN')
  if (!token) return [falta('La clave responde', ['MESSENGER_PAGE_TOKEN'])]
  const cab = { Authorization: `Bearer ${token}` }
  const pagina = v(env, 'MESSENGER_PAGE_ID') ?? 'me'

  const [yo, susc, app] = await Promise.all([
    http(`https://graph.facebook.com/${GRAPH}/me?fields=id,name`, { headers: cab }),
    http(`https://graph.facebook.com/${GRAPH}/${encodeURIComponent(pagina)}/subscribed_apps`, { headers: cab }),
    estadoWebhookDeApp(env, 'page', url),
  ])
  const hay = susc.ok && ((susc.datos as { data?: unknown[] } | null)?.data ?? []).length > 0
  return [
    yo.ok
      ? { titulo: 'La clave responde', ok: true, detalle: `Página «${(yo.datos as { name?: string })?.name ?? '?'}».` }
      : { titulo: 'La clave responde', ok: false, detalle: motivoMeta(yo) },
    { titulo: 'La página está suscripta a los mensajes', ok: susc.ok ? hay : false, detalle: !susc.ok ? motivoMeta(susc) : hay ? 'Sí.' : 'No. Apretá «Conectar».' },
    app,
  ]
}

async function verificarTelegram(env: Entorno, url: string): Promise<PasoConexion[]> {
  const token = v(env, 'TELEGRAM_BOT_TOKEN')
  if (!token) return [falta('El bot responde', ['TELEGRAM_BOT_TOKEN'])]
  const [yo, info] = await Promise.all([
    http(`https://api.telegram.org/bot${token}/getMe`),
    http(`https://api.telegram.org/bot${token}/getWebhookInfo`),
  ])
  const bot = (yo.datos as { ok?: boolean; result?: { username?: string } } | null)
  const w = (info.datos as { result?: { url?: string; last_error_message?: string } } | null)?.result
  return [
    bot?.ok ? { titulo: 'El bot responde', ok: true, detalle: `@${bot.result?.username ?? '?'}.` } : { titulo: 'El bot responde', ok: false, detalle: 'Telegram rechazó el token.' },
    {
      titulo: 'Telegram tiene la URL de este sistema',
      ok: w?.url === url,
      detalle: w?.url === url ? 'Está apuntando acá.' : w?.url ? `Apunta a otra dirección (${w.url}).` : 'Todavía no hay webhook. Apretá «Conectar».',
    },
    ...(w?.last_error_message ? [{ titulo: 'Último error que Telegram tuvo al avisar', ok: false as const, detalle: w.last_error_message }] : []),
  ]
}

async function verificarCorreo(env: Entorno): Promise<PasoConexion[]> {
  const clave = v(env, 'RESEND_API_KEY')
  if (!clave) return [falta('La clave de Resend responde', ['RESEND_API_KEY'])]
  const r = await http('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${clave}` } })
  const pasos: PasoConexion[] = []
  if (r.status === 401) pasos.push({ titulo: 'La clave de Resend responde', ok: false, detalle: 'Resend rechazó la clave.' })
  else if (r.status === 403) pasos.push({ titulo: 'La clave de Resend responde', ok: true, detalle: 'Es una clave de «sólo envío»: para recibir correos hace falta una con acceso completo.' })
  else if (!r.ok) pasos.push({ titulo: 'La clave de Resend responde', ok: false, detalle: `Resend respondió ${r.status}.` })
  else {
    const dominios = (r.datos as { data?: { name: string; status: string }[] } | null)?.data ?? []
    const de = (v(env, 'EMAIL_FROM') ?? '').match(/@([^>\s]+)/)?.[1]?.toLowerCase()
    const propio = dominios.find((d) => d.name.toLowerCase() === de)
    pasos.push(
      !de
        ? { titulo: 'El dominio del remitente está verificado', ok: null, detalle: 'Falta EMAIL_FROM.' }
        : propio?.status === 'verified'
          ? { titulo: 'El dominio del remitente está verificado', ok: true, detalle: de }
          : { titulo: 'El dominio del remitente está verificado', ok: false, detalle: propio ? `${de} está en Resend pero no verificado (${propio.status}).` : `${de} no está cargado en Resend.` },
    )
  }
  pasos.push(
    v(env, 'RESEND_WEBHOOK_SECRET')
      ? { titulo: 'Hay secreto del webhook (para ver rebotes y recibir correos)', ok: true, detalle: 'Cargado.' }
      : { titulo: 'Hay secreto del webhook (para ver rebotes y recibir correos)', ok: false, detalle: 'Falta RESEND_WEBHOOK_SECRET. Apretá «Crear el webhook en Resend».' },
  )
  return pasos
}
