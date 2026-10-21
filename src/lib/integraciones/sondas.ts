/**
 * Pruebas de conexión de las integraciones (ADR 0043).
 *
 * Cada prueba es una consulta de SOLO LECTURA contra el proveedor —quién soy,
 * qué dominio tengo, cuál es mi número—: confirma que la clave es válida sin
 * cobrar, sin mandar un mensaje y sin cambiar nada del otro lado.
 *
 * ⚠️ Este archivo NO importa nada, a propósito: lo carga también
 * `scripts/verificar-integraciones.mjs` con Node directo (que entiende
 * TypeScript sin compilar mientras no haya imports con alias). Recibe el
 * entorno como parámetro por lo mismo.
 *
 * Ninguna respuesta incluye el valor de una clave: sólo si sirvió y, cuando
 * ayuda, a QUÉ cuenta pertenece (el nombre del bot, el número de WhatsApp, el
 * dominio de correo), que es lo que permite darse cuenta de que se pegó la
 * clave de otra cuenta.
 */

export interface ResultadoSonda {
  ok: boolean
  detalle: string
}

type Entorno = Record<string, string | undefined>

const GRAPH = 'v21.0'
const TIMEOUT = 8_000

function v(env: Entorno, nombre: string): string | undefined {
  const x = env[nombre]?.trim()
  return x ? x : undefined
}

async function obtener(url: string, cabeceras: Record<string, string> = {}): Promise<{ ok: boolean; status: number; datos: unknown }> {
  const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store' })
  const datos = await r.json().catch(() => null)
  return { ok: r.ok, status: r.status, datos }
}

function errorMeta(datos: unknown, status: number): string {
  const e = (datos as { error?: { code?: number; message?: string } } | null)?.error
  if (e?.code === 190) return 'El token venció o fue revocado.'
  return `Meta respondió ${status}${e?.message ? `: ${e.message.slice(0, 160)}` : ''}.`
}

const SONDAS: Record<string, (env: Entorno) => Promise<ResultadoSonda>> = {
  async supabase(env) {
    const url = v(env, 'NEXT_PUBLIC_SUPABASE_URL')
    const clave = v(env, 'SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !clave) return { ok: false, detalle: 'Faltan la URL o la clave secreta.' }
    const r = await obtener(`${url.replace(/\/+$/, '')}/rest/v1/crm_bandejas?select=canal&limit=1`, {
      apikey: clave,
      Authorization: `Bearer ${clave}`,
    })
    if (r.ok) return { ok: true, detalle: 'La base responde y la clave secreta es válida.' }
    if (r.status === 401) return { ok: false, detalle: 'La clave secreta no es válida. ¿Es la del protocolo S3 del Storage? Esa no sirve.' }
    if (r.status === 404) return { ok: false, detalle: 'La base responde pero le faltan migraciones (no existe la bandeja). Aplicá las migraciones pendientes.' }
    return { ok: false, detalle: `La base respondió ${r.status}.` }
  },

  async mercadopago(env) {
    const token = v(env, 'MERCADOPAGO_ACCESS_TOKEN')
    if (!token) return { ok: false, detalle: 'Falta MERCADOPAGO_ACCESS_TOKEN.' }
    const r = await obtener('https://api.mercadopago.com/users/me', { Authorization: `Bearer ${token}` })
    if (!r.ok) return { ok: false, detalle: `Mercado Pago rechazó el token (${r.status}).` }
    const d = r.datos as { nickname?: string; site_id?: string }
    const prueba = token.startsWith('TEST-') ? ' ⚠️ Es un token de PRUEBA: no cobra de verdad.' : ''
    return { ok: true, detalle: `Cuenta ${d.nickname ?? 'sin nombre'} (${d.site_id ?? '?'}).${prueba}` }
  },

  async stripe(env) {
    const clave = v(env, 'STRIPE_SECRET_KEY')
    if (!clave) return { ok: false, detalle: 'Falta STRIPE_SECRET_KEY.' }
    const r = await obtener('https://api.stripe.com/v1/balance', { Authorization: `Bearer ${clave}` })
    if (!r.ok) return { ok: false, detalle: `Stripe rechazó la clave (${r.status}).` }
    const prueba = clave.startsWith('sk_test_') ? ' ⚠️ Es una clave de PRUEBA: no cobra de verdad.' : ''
    return { ok: true, detalle: `Clave válida.${prueba}` }
  },

  async resend(env) {
    const clave = v(env, 'RESEND_API_KEY')
    if (!clave) return { ok: false, detalle: 'Falta RESEND_API_KEY.' }
    const r = await obtener('https://api.resend.com/domains', { Authorization: `Bearer ${clave}` })
    if (r.status === 401 || r.status === 403) {
      // Una clave «sólo envío» no puede listar dominios: es válida pero acotada.
      return r.status === 401
        ? { ok: false, detalle: 'Resend rechazó la clave.' }
        : { ok: true, detalle: 'La clave es válida pero de «sólo envío»: para recibir correos en la bandeja hace falta una con acceso completo.' }
    }
    if (!r.ok) return { ok: false, detalle: `Resend respondió ${r.status}.` }
    const dominios = ((r.datos as { data?: { name: string; status: string }[] })?.data ?? [])
    const remitente = (v(env, 'EMAIL_FROM') ?? '').match(/@([^>\s]+)/)?.[1]?.toLowerCase()
    const propio = dominios.find((d) => d.name.toLowerCase() === remitente)
    if (!remitente) return { ok: true, detalle: `Clave válida. Falta EMAIL_FROM. Dominios: ${dominios.map((d) => d.name).join(', ') || 'ninguno'}.` }
    if (!propio) return { ok: false, detalle: `El dominio de EMAIL_FROM (${remitente}) no está cargado en Resend.` }
    if (propio.status !== 'verified') return { ok: false, detalle: `El dominio ${remitente} está en Resend pero todavía no verificado (${propio.status}). Revisá los registros DNS.` }
    return { ok: true, detalle: `Dominio ${remitente} verificado.` }
  },

  async whatsapp(env) {
    const token = v(env, 'WHATSAPP_TOKEN')
    const numero = v(env, 'WHATSAPP_PHONE_NUMBER_ID')
    if (!token || !numero) return { ok: false, detalle: 'Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID.' }
    const r = await obtener(
      `https://graph.facebook.com/${GRAPH}/${encodeURIComponent(numero)}?fields=display_phone_number,verified_name,quality_rating`,
      { Authorization: `Bearer ${token}` },
    )
    if (!r.ok) return { ok: false, detalle: errorMeta(r.datos, r.status) }
    const d = r.datos as { display_phone_number?: string; verified_name?: string; quality_rating?: string }
    return { ok: true, detalle: `Número ${d.display_phone_number ?? '?'} (${d.verified_name ?? 'sin nombre verificado'}), calidad ${d.quality_rating ?? '?'}.` }
  },

  async instagram(env) {
    const token = v(env, 'INSTAGRAM_ACCESS_TOKEN')
    if (!token) return { ok: false, detalle: 'Falta INSTAGRAM_ACCESS_TOKEN.' }
    const r = await obtener(`https://graph.instagram.com/${GRAPH}/me?fields=user_id,username`, { Authorization: `Bearer ${token}` })
    if (!r.ok) return { ok: false, detalle: errorMeta(r.datos, r.status) }
    const d = r.datos as { username?: string; user_id?: string }
    const id = v(env, 'INSTAGRAM_ACCOUNT_ID')
    const distinto = id && d.user_id && id !== d.user_id ? ` ⚠️ INSTAGRAM_ACCOUNT_ID (${id}) no coincide con la cuenta del token (${d.user_id}).` : ''
    return { ok: true, detalle: `Cuenta @${d.username ?? '?'}.${distinto}` }
  },

  async messenger(env) {
    const token = v(env, 'MESSENGER_PAGE_TOKEN')
    if (!token) return { ok: false, detalle: 'Falta MESSENGER_PAGE_TOKEN.' }
    const r = await obtener(`https://graph.facebook.com/${GRAPH}/me?fields=id,name`, { Authorization: `Bearer ${token}` })
    if (!r.ok) return { ok: false, detalle: errorMeta(r.datos, r.status) }
    const d = r.datos as { id?: string; name?: string }
    const id = v(env, 'MESSENGER_PAGE_ID')
    const distinto = id && d.id && id !== d.id ? ` ⚠️ MESSENGER_PAGE_ID (${id}) no coincide con la página del token (${d.id}).` : ''
    return { ok: true, detalle: `Página «${d.name ?? '?'}».${distinto}` }
  },

  async telegram(env) {
    const token = v(env, 'TELEGRAM_BOT_TOKEN')
    if (!token) return { ok: false, detalle: 'Falta TELEGRAM_BOT_TOKEN.' }
    const r = await obtener(`https://api.telegram.org/bot${token}/getMe`)
    const d = r.datos as { ok?: boolean; result?: { username?: string } } | null
    if (!r.ok || !d?.ok) return { ok: false, detalle: 'Telegram rechazó el token.' }
    const w = await obtener(`https://api.telegram.org/bot${token}/getWebhookInfo`)
    const url = (w.datos as { result?: { url?: string } } | null)?.result?.url
    return { ok: true, detalle: `Bot @${d.result?.username ?? '?'}. ${url ? `Webhook: ${url}` : 'Todavía sin webhook: apretá «Conectar el bot».'}` }
  },

  async ia(env) {
    const base = v(env, 'IA_BASE_URL')
    const clave = v(env, 'IA_API_KEY')
    if (!base || !clave) return { ok: false, detalle: 'Faltan IA_BASE_URL o IA_API_KEY.' }
    const r = await obtener(`${base.replace(/\/+$/, '')}/models`, { Authorization: `Bearer ${clave}` })
    if (!r.ok) return { ok: false, detalle: `El proveedor de IA respondió ${r.status}.` }
    const modelos = ((r.datos as { data?: { id: string }[] } | null)?.data ?? []).map((m) => m.id.replace(/^models\//, ''))
    const modelo = v(env, 'IA_MODELO')
    if (modelo && modelos.length > 0 && !modelos.includes(modelo)) {
      return { ok: false, detalle: `La clave es válida pero el modelo «${modelo}» no está entre los disponibles.` }
    }
    return { ok: true, detalle: `Clave válida${modelo ? `, modelo ${modelo}` : ''}.` }
  },

  async cotizacion(env) {
    const url = v(env, 'DOLARAPI_URL') ?? 'https://dolarapi.com/v1/dolares/oficial'
    const r = await obtener(url)
    if (!r.ok) return { ok: false, detalle: `La fuente de cotización respondió ${r.status}.` }
    const venta = (r.datos as { venta?: number } | null)?.venta
    return { ok: true, detalle: venta ? `Dólar oficial: venta ${venta}.` : 'La fuente responde.' }
  },
}

export function tieneSonda(id: string): boolean {
  return id in SONDAS
}

/** Prueba una integración. Nunca lanza: un corte de red es un resultado más. */
export async function probarIntegracion(id: string, env: Entorno): Promise<ResultadoSonda> {
  const sonda = SONDAS[id]
  if (!sonda) return { ok: false, detalle: 'Esta integración no se puede probar sin operar de verdad.' }
  try {
    return await sonda(env)
  } catch (e) {
    const motivo = e instanceof Error ? (e.name === 'TimeoutError' ? 'no respondió a tiempo' : e.message) : String(e)
    return { ok: false, detalle: `No se pudo conectar: ${motivo}.` }
  }
}

/**
 * Registra el webhook del bot de Telegram (`setWebhook`) con el secreto. Es lo
 * único que Telegram necesita: no hay pantalla del otro lado donde pegar la URL.
 */
export async function conectarTelegram(env: Entorno, urlWebhook: string): Promise<ResultadoSonda> {
  const token = v(env, 'TELEGRAM_BOT_TOKEN')
  const secreto = v(env, 'TELEGRAM_WEBHOOK_SECRET')
  if (!token || !secreto) return { ok: false, detalle: 'Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET.' }
  if (!/^https:\/\//.test(urlWebhook)) {
    return { ok: false, detalle: 'Telegram exige una dirección https pública: NEXT_PUBLIC_SITE_URL tiene que ser la del sistema publicado.' }
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secreto)) {
    return { ok: false, detalle: 'TELEGRAM_WEBHOOK_SECRET sólo admite letras, números, _ y -.' }
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlWebhook, secret_token: secreto, allowed_updates: ['message', 'edited_message'] }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const d = (await r.json().catch(() => null)) as { ok?: boolean; description?: string } | null
    return d?.ok ? { ok: true, detalle: 'Bot conectado: los mensajes van a entrar a la bandeja.' } : { ok: false, detalle: `Telegram respondió: ${d?.description ?? r.status}.` }
  } catch (e) {
    return { ok: false, detalle: `No se pudo conectar: ${e instanceof Error ? e.message : String(e)}.` }
  }
}
