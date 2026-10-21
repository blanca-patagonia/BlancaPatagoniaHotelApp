'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { enviarAlChatRecepcion, iniciarChatRecepcion, leerChatRecepcion, type ResultadoChat } from './recepcion'
import type { MensajeChatWeb } from '@/lib/bandeja/chat-web'
import type { Diccionario } from '@/lib/i18n/diccionarios/es'

/** Cada cuánto se miran respuestas nuevas mientras el chat está abierto. */
const CADA_MS = 5000

/**
 * Chat con recepción, dentro del asistente del portal (canal `web` de la
 * bandeja, ADR 0043).
 *
 * Consulta cada 5 segundos en vez de usar Realtime: el visitante es `anon` y
 * no tiene ningún permiso sobre las tablas de la bandeja, a propósito. Abrirle
 * una suscripción exigiría una política para `anon`, y eso es exactamente lo
 * que la 0125 no quiere.
 */
export function ChatRecepcion({ t, alVolver }: { t: Diccionario['asistente']; alVolver: () => void }) {
  const [mensajes, setMensajes] = useState<MensajeChatWeb[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  const finRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    let vivo = true
    const leer = async () => {
      const m = await leerChatRecepcion()
      if (vivo) setMensajes(m)
    }
    void leer()
    const intervalo = setInterval(leer, CADA_MS)
    return () => {
      vivo = false
      clearInterval(intervalo)
    }
  }, [])

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' })
  }, [mensajes])

  function resultado(r: ResultadoChat) {
    if ('ok' in r) {
      setMensajes(r.mensajes)
      setError(null)
      formRef.current?.reset()
    } else {
      setError(r.error === 'limite' ? t.recepcionLimite : t.recepcionError)
    }
  }

  const conChat = Array.isArray(mensajes) && mensajes.length > 0

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-5 py-2">
        <p className="text-sm font-medium text-stone-800">{t.recepcionTitulo}</p>
        <button type="button" onClick={alVolver} className="text-xs text-lago-700 underline">
          {t.recepcionVolver}
        </button>
      </div>

      {mensajes === undefined ? (
        <p className="px-5 py-6 text-sm text-stone-500">{t.escribiendo}</p>
      ) : !conChat ? (
        <form
          ref={formRef}
          action={(fd) => iniciar(async () => resultado(await iniciarChatRecepcion(fd)))}
          className="flex flex-col gap-2 px-5 py-4"
        >
          <p className="text-sm text-stone-600">{t.recepcionIntro}</p>
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-700">
            {t.recepcionNombre}
            <input name="nombre" required maxLength={80} autoComplete="name" className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal outline-none focus:border-lago-600" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-700">
            {t.recepcionEmail}
            <input name="email" type="email" required maxLength={120} autoComplete="email" className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal outline-none focus:border-lago-600" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-700">
            {t.recepcionMensaje}
            <textarea name="mensaje" required rows={3} maxLength={1000} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal outline-none focus:border-lago-600" />
          </label>
          {error && (
            <p className="text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pendiente}
            className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800 disabled:opacity-60"
          >
            {pendiente ? t.escribiendo : t.recepcionIniciar}
          </button>
        </form>
      ) : (
        <>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto px-5 py-4" aria-live="polite">
            {mensajes.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line ${
                  m.de === 'visitante' ? 'self-end bg-lago-700 text-white' : 'self-start bg-stone-100 text-stone-800'
                }`}
              >
                <span className="mb-0.5 block text-[11px] opacity-75">{m.de === 'visitante' ? t.recepcionTu : t.recepcionHotel}</span>
                {m.texto}
              </div>
            ))}
            {mensajes.every((m) => m.de === 'visitante') && (
              <p className="self-start text-xs text-stone-500">{t.recepcionEsperando}</p>
            )}
            <div ref={finRef} />
          </div>
          {error && (
            <p className="px-5 text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
          <form
            ref={formRef}
            action={(fd) => iniciar(async () => resultado(await enviarAlChatRecepcion(String(fd.get('texto') ?? ''))))}
            className="flex items-center gap-2 border-t border-stone-100 px-5 py-3"
          >
            <input
              name="texto"
              required
              maxLength={1000}
              placeholder={t.campo}
              aria-label={t.recepcionMensaje}
              autoComplete="off"
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600"
            />
            <button
              type="submit"
              disabled={pendiente}
              className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800 disabled:opacity-60"
            >
              {t.enviar}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
