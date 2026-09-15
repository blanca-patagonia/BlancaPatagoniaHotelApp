'use client'

import { useEffect, useRef, useState } from 'react'
import { Mensaje, botonClases } from '../_components/ui'

interface MensajeChat {
  rol: 'user' | 'assistant'
  texto: string
}

/** Cuántos mensajes de historial se mandan al servidor (ver `MAX_MENSAJES` en la route). */
const TOPE_HISTORIAL = 20

const PREGUNTAS_SUGERIDAS = [
  '¿Cómo viene la ocupación este mes?',
  '¿Qué categoría de habitación vendió más este mes?',
  '¿Cuánto se facturó este mes y por qué medio se cobró?',
  '¿Cómo están las reservas por estado y por canal?',
]

/** Indicador circular de progreso, igual al de `BotonEnvio` (no está exportado desde ahí). */
function Girador() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function ChatIA() {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const finRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' })
  }, [mensajes, enviando])

  async function enviar(pregunta: string) {
    const limpia = pregunta.trim()
    if (!limpia || enviando) return

    const historial = [...mensajes, { rol: 'user' as const, texto: limpia }]
    setMensajes(historial)
    setTexto('')
    setError(null)
    setEnviando(true)

    try {
      const r = await fetch('/panel/ia/consulta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mensajes: historial.slice(-TOPE_HISTORIAL).map((m) => ({ rol: m.rol, contenido: m.texto })),
        }),
      })
      const datos = (await r.json().catch(() => ({}))) as { respuesta?: string; error?: string }

      if (!r.ok || datos.error) {
        setError(datos.error ?? 'No se pudo consultar al asistente. Probá de nuevo.')
        return
      }
      setMensajes((previos) => [...previos, { rol: 'assistant', texto: datos.respuesta ?? '' }])
    } catch {
      setError('No se pudo conectar con el asistente. Revisá la conexión y probá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex h-[32rem] flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        {mensajes.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
            <p className="text-sm text-stone-600">
              Preguntale por la ocupación, el ADR, la facturación o las reservas del hotel.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {PREGUNTAS_SUGERIDAS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => enviar(p)}
                  disabled={enviando}
                  className="rounded-full border border-stone-300 px-3 py-1.5 text-xs text-stone-700 transition hover:border-lago-400 hover:text-lago-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) => {
          const propio = m.rol === 'user'
          return (
            <div key={i} className={`flex flex-col ${propio ? 'items-end' : 'items-start'}`}>
              <p className={`mt-3 mb-0.5 text-xs text-stone-600 ${propio ? 'text-right' : ''}`}>
                {propio ? 'Vos' : 'Asistente'}
              </p>
              <p
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line ${
                  propio ? 'bg-lago-700 text-white' : 'bg-stone-100 text-stone-800'
                }`}
              >
                {m.texto}
              </p>
            </div>
          )
        })}

        {enviando && (
          <div className="mt-3 flex items-center gap-2 text-sm text-stone-500">
            <Girador />
            Consultando el sistema…
          </div>
        )}

        <div ref={finRef} />
      </div>

      {error && (
        <div className="px-5 pb-2">
          <Mensaje tono="error">{error}</Mensaje>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          enviar(texto)
        }}
        className="flex items-end gap-2 border-t border-stone-100 px-5 py-3"
      >
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar(texto)
            }
          }}
          required
          rows={1}
          disabled={enviando}
          placeholder="Preguntale algo al asistente…"
          aria-label="Tu pregunta"
          className="min-w-0 flex-1 resize-none rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={enviando || !texto.trim()}
          className={botonClases('primario', 'w-auto disabled:cursor-wait disabled:opacity-60')}
        >
          {enviando ? <Girador /> : 'Preguntar'}
        </button>
      </form>
    </div>
  )
}
