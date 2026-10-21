'use server'

import { cookies } from 'next/headers'
import { permitirIntento } from '@/lib/limites'
import {
  COOKIE_CHAT,
  leerChat,
  mensajeDelVisitante,
  nuevoToken,
  tokenValido,
  type MensajeChatWeb,
} from '@/lib/bandeja/chat-web'

/**
 * Acciones públicas del chat con recepción (canal `web` de la bandeja, ADR 0043).
 *
 * Sin sesión: cualquiera puede abrir el chat. Las tres barreras son el límite
 * por IP (`chat_web`), el largo máximo de cada campo y que la identidad viaje en
 * una cookie httpOnly que el script de la página no puede leer.
 *
 * Los errores vuelven como claves (`error`, `limite`) y la pantalla los traduce
 * con el diccionario del idioma del visitante.
 */

const MAX_TEXTO = 1000
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TREINTA_DIAS = 60 * 60 * 24 * 30

export type ResultadoChat = { ok: true; mensajes: MensajeChatWeb[] } | { error: 'error' | 'limite' | 'datos' }

export async function iniciarChatRecepcion(formData: FormData): Promise<ResultadoChat> {
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 80)
  const email = String(formData.get('email') ?? '').trim().toLowerCase().slice(0, 120)
  const texto = String(formData.get('mensaje') ?? '').trim().slice(0, MAX_TEXTO)
  if (!nombre || !RE_EMAIL.test(email) || !texto) return { error: 'datos' }
  if (!(await permitirIntento('chat_web'))) return { error: 'limite' }

  const almacen = await cookies()
  const previo = almacen.get(COOKIE_CHAT)?.value
  // Si ya tenía un chat, sigue en el mismo: un visitante, una conversación.
  const token = tokenValido(previo) ? previo : nuevoToken()

  if (!(await mensajeDelVisitante(token, texto, { nombre, email }))) return { error: 'error' }

  almacen.set(COOKIE_CHAT, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TREINTA_DIAS,
    path: '/',
  })
  const mensajes = await leerChat(token)
  return mensajes ? { ok: true, mensajes } : { error: 'error' }
}

export async function enviarAlChatRecepcion(texto: string): Promise<ResultadoChat> {
  const limpio = texto.trim().slice(0, MAX_TEXTO)
  if (!limpio) return { error: 'datos' }
  const token = (await cookies()).get(COOKIE_CHAT)?.value
  if (!tokenValido(token)) return { error: 'datos' }
  if (!(await permitirIntento('chat_web'))) return { error: 'limite' }

  if (!(await mensajeDelVisitante(token, limpio))) return { error: 'error' }
  const mensajes = await leerChat(token)
  return mensajes ? { ok: true, mensajes } : { error: 'error' }
}

/** Lo que hay hasta ahora. `null` si el visitante nunca abrió un chat. */
export async function leerChatRecepcion(): Promise<MensajeChatWeb[] | null> {
  const token = (await cookies()).get(COOKIE_CHAT)?.value
  if (!tokenValido(token)) return null
  return (await leerChat(token)) ?? []
}
