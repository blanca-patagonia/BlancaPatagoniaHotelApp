'use server'

import { revalidatePath } from 'next/cache'
import { requerirRol } from '@/lib/auth/session'
import { registrarAviso } from '@/lib/registro'
import { registrarFalla } from '@/lib/acciones'
import { guardarAjustesDeBandeja } from '@/lib/bandeja/gestion'
import { CANALES_BANDEJA, validarAjustes, type CanalBandeja } from '@/lib/domain/bandeja'
import { urlPublicaValida, urlWebhook } from '@/lib/domain/integraciones'
import { deLista } from '@/lib/domain/listas'
import {
  conectarInstagram,
  conectarMessenger,
  conectarWhatsApp,
  crearWebhookDeCorreo,
  verificarConexion,
  type CanalConectable,
  type PasoConexion,
} from '@/lib/integraciones/meta'
import { conectarTelegram } from '@/lib/integraciones/sondas'

/**
 * Acciones del asistente de conexión de canales (ADR 0044).
 *
 * Sólo la dirección (`requerirRol`, más estrecho que el área): conectar un canal
 * cambia la configuración del lado de Meta, Telegram o Resend, y probar una
 * clave revela a qué cuenta pertenece.
 *
 * ⚠️ Ninguna de estas acciones devuelve ni registra una clave. El único secreto
 * que sale es el que Resend entrega al crear el webhook, que se muestra UNA vez
 * y que el sistema no puede guardar por sí mismo (las claves viven en variables
 * de entorno, ADR 0043).
 */

const CONECTABLES = ['whatsapp', 'instagram', 'messenger', 'telegram', 'email'] as const

const RUTA_WEBHOOK: Record<CanalConectable, string> = {
  whatsapp: '/api/webhooks/meta',
  instagram: '/api/webhooks/meta',
  messenger: '/api/webhooks/meta',
  telegram: '/api/webhooks/telegram',
  email: '/api/webhooks/email/resend',
}

export interface EstadoConexion {
  pasos?: PasoConexion[]
  ok?: boolean
  error?: string
  /** Sólo al crear el webhook de correo. Se muestra una vez. */
  secreto?: string
  en?: number
}

function canalDe(formData: FormData): CanalConectable | null {
  return deLista(CONECTABLES, String(formData.get('canal') ?? '')) ?? null
}

/** La URL a la que el proveedor va a llamar, o el motivo por el que no sirve. */
function destinoPublico(canal: CanalConectable): { url: string } | { error: string } {
  const sitio = process.env.NEXT_PUBLIC_SITE_URL
  const v = urlPublicaValida(sitio)
  if (!v.valida) return { error: v.motivo ?? 'La dirección del sistema no sirve.' }
  return { url: urlWebhook(sitio, RUTA_WEBHOOK[canal]) }
}

export async function conectarCanal(_prev: EstadoConexion, formData: FormData): Promise<EstadoConexion> {
  await requerirRol('admin', 'gerencia')
  const canal = canalDe(formData)
  if (!canal || canal === 'email') return { error: 'Canal desconocido.' }
  const destino = destinoPublico(canal)
  if ('error' in destino) return { error: destino.error, en: Date.now() }

  let r: { ok: boolean; pasos: PasoConexion[] }
  if (canal === 'whatsapp') r = await conectarWhatsApp(process.env, destino.url)
  else if (canal === 'instagram') r = await conectarInstagram(process.env, destino.url)
  else if (canal === 'messenger') r = await conectarMessenger(process.env, destino.url)
  else {
    const t = await conectarTelegram(process.env, destino.url)
    r = { ok: t.ok, pasos: [{ titulo: 'Registrar el webhook del bot', ok: t.ok, detalle: t.detalle }] }
  }

  // Sin detalle: puede traer nombres de cuentas. Basta saber quién conectó qué y si salió.
  await registrarAviso('bandeja_canal_conectado', { canal, ok: r.ok })
  return { ok: r.ok, pasos: r.pasos, en: Date.now() }
}

export async function verificarCanal(_prev: EstadoConexion, formData: FormData): Promise<EstadoConexion> {
  await requerirRol('admin', 'gerencia')
  const canal = canalDe(formData)
  if (!canal) return { error: 'Canal desconocido.' }
  const destino = destinoPublico(canal)
  // Sin dirección pública igual se puede verificar la clave; sólo que la URL no se compara.
  const url = 'url' in destino ? destino.url : urlWebhook(process.env.NEXT_PUBLIC_SITE_URL, RUTA_WEBHOOK[canal])
  const pasos = await verificarConexion(canal, process.env, url)
  return { ok: pasos.every((p) => p.ok !== false), pasos, en: Date.now() }
}

export async function crearWebhookCorreo(): Promise<EstadoConexion> {
  await requerirRol('admin', 'gerencia')
  const destino = destinoPublico('email')
  if ('error' in destino) return { error: destino.error, en: Date.now() }
  const r = await crearWebhookDeCorreo(process.env, destino.url)
  await registrarAviso('bandeja_webhook_correo_creado', { ok: r.ok })
  return r.ok
    ? { ok: true, secreto: r.secreto, pasos: [{ titulo: 'Crear el webhook en Resend', ok: true, detalle: r.detalle }], en: Date.now() }
    : { ok: false, error: r.detalle, en: Date.now() }
}

// ── Ajustes del canal ───────────────────────────────────────────────────────

export interface EstadoAjustes {
  ok?: boolean
  error?: string
}

export async function guardarAjustes(_prev: EstadoAjustes, formData: FormData): Promise<EstadoAjustes> {
  await requerirRol('admin', 'gerencia')
  const canal = deLista(CANALES_BANDEJA, String(formData.get('canal') ?? '')) as CanalBandeja | undefined
  if (!canal) return { error: 'Canal desconocido.' }

  const r = validarAjustes({
    activa: formData.get('activa') === 'on',
    saludoActivo: formData.get('saludo_activo') === 'on',
    saludoMensaje: String(formData.get('saludo_mensaje') ?? ''),
    fueraHorarioActivo: formData.get('fuera_horario_activo') === 'on',
    fueraHorarioMensaje: String(formData.get('fuera_horario_mensaje') ?? ''),
    horarioDesde: String(formData.get('horario_desde') ?? ''),
    horarioHasta: String(formData.get('horario_hasta') ?? ''),
    dias: formData.getAll('dias').map((d) => Number(d)),
    asignacionAutomatica: formData.get('asignacion_automatica') === 'on',
  })
  if ('error' in r) return { error: r.error }

  const error = await guardarAjustesDeBandeja(canal, r.datos)
  if (error) {
    registrarFalla(error, 'bandeja:ajustes_guardar')
    return { error: 'No se pudieron guardar los ajustes. Probá de nuevo.' }
  }
  revalidatePath('/panel/bandeja')
  return { ok: true }
}
