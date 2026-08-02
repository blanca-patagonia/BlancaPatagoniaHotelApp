'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { preguntarAlAsistente } from './acciones'
import type { AccionSugerida } from '@/lib/domain/asistente'

/**
 * Asistente del portal público.
 *
 * Es el único componente de cliente del portal: necesita estado para sostener
 * la conversación. Las respuestas las calcula el servidor con el motor de
 * reglas (`AsistenteProvider`), así que acá no hay nada de lógica de negocio.
 */

interface Burbuja {
  de: 'huesped' | 'asistente'
  texto: string
  accion?: AccionSugerida
}

const SALUDO: Burbuja = {
  de: 'asistente',
  texto:
    '¡Hola! Puedo ayudarte con horarios de check-in y check-out, política de cancelación, ' +
    'servicios de la hostería y disponibilidad. ¿Qué necesitás saber?',
}

const SUGERENCIAS = [
  '¿A qué hora es el check-in?',
  '¿Cómo es la política de cancelación?',
  '¿Qué servicios incluye?',
]

export function ChatAsistente() {
  const [burbujas, setBurbujas] = useState<Burbuja[]>([SALUDO])
  const [pendiente, iniciarTransicion] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function preguntar(pregunta: string) {
    const texto = pregunta.trim()
    if (!texto || pendiente) return

    setBurbujas((previas) => [...previas, { de: 'huesped', texto }])
    formRef.current?.reset()

    iniciarTransicion(async () => {
      const r = await preguntarAlAsistente(texto)
      setBurbujas((previas) => [
        ...previas,
        { de: 'asistente', texto: r.texto, accion: r.accion },
      ])
    })
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-stone-100 px-5 py-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-lago-100 text-lago-700">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.5 12.5c0 3.6-3.8 6.5-8.5 6.5-1 0-2-.1-2.9-.4l-5.1 1.4 1.5-4.2c-1.2-1-1.9-2.4-1.9-3.9C3.6 8.9 7.4 6 12 6s8.5 2.9 8.5 6.5z" />
          </svg>
        </span>
        <div>
          <h2 className="font-display text-base font-semibold text-stone-900">
            Asistente de Blanca Patagonia
          </h2>
          <p className="text-xs text-stone-500">Respondemos al instante las consultas frecuentes.</p>
        </div>
      </header>

      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto px-5 py-4" aria-live="polite">
        {burbujas.map((b, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line ${
              b.de === 'huesped'
                ? 'self-end bg-lago-700 text-white'
                : 'self-start bg-stone-100 text-stone-800'
            }`}
          >
            {b.texto}
            {b.accion && (
              <Link
                href={b.accion.href}
                className="mt-2 block rounded-lg bg-white px-3 py-1.5 text-center text-xs font-medium text-lago-800 ring-1 ring-lago-200 transition hover:bg-lago-50"
              >
                {b.accion.etiqueta}
              </Link>
            )}
          </div>
        ))}
        {pendiente && (
          <p className="self-start rounded-2xl bg-stone-100 px-3.5 py-2 text-sm text-stone-400">
            Escribiendo…
          </p>
        )}
      </div>

      {burbujas.length === 1 && (
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => preguntar(s)}
              className="rounded-full bg-stone-50 px-3 py-1 text-xs text-stone-600 ring-1 ring-stone-200 transition hover:bg-stone-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        ref={formRef}
        action={(formData) => preguntar(String(formData.get('pregunta') ?? ''))}
        className="flex items-center gap-2 border-t border-stone-100 px-5 py-3"
      >
        <input
          name="pregunta"
          placeholder="Escribí tu consulta…"
          aria-label="Tu consulta para el asistente"
          autoComplete="off"
          className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600"
        />
        <button
          type="submit"
          disabled={pendiente}
          className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800 disabled:opacity-60"
        >
          Enviar
        </button>
      </form>
    </section>
  )
}
