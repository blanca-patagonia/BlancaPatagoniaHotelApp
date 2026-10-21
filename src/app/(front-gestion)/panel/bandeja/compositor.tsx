'use client'

import { useActionState, useState, type KeyboardEvent } from 'react'
import { responder, type EstadoRespuesta } from './actions'
import { aplicarVariables, sugerirRespuestas, type RespuestaGuardada } from '@/lib/domain/bandeja'
import { botonClases } from '../_components/ui'

/**
 * La caja de respuesta de una conversación.
 *
 * Dos modos, como Chatwoot: «Responder» (sale al huésped) y «Nota privada» (la
 * ve sólo el staff). El modo nota cambia el color de la caja entera, no sólo
 * una pestaña: escribir una nota interna creyendo que es una respuesta —o al
 * revés— es el error caro de este tipo de pantalla.
 *
 * Las respuestas guardadas se invocan escribiendo «/» y el atajo.
 */
export function Compositor({
  conversacionId,
  respuestas,
  bloqueo,
  canal,
  variables,
}: {
  conversacionId: string
  respuestas: RespuestaGuardada[]
  /** Si no se puede responder por el canal: el porqué. Las notas siguen andando. */
  bloqueo: string | null
  canal: string
  /** Para `{{nombre}}`, `{{agente}}` en las respuestas guardadas. */
  variables: Record<string, string>
}) {
  const [estado, accion, enviando] = useActionState<EstadoRespuesta, FormData>(responder, {})
  const [modo, setModo] = useState<'respuesta' | 'nota'>(bloqueo ? 'nota' : 'respuesta')
  const [texto, setTexto] = useState('')
  const [ultimoEnvio, setUltimoEnvio] = useState<number | undefined>(undefined)

  // Vacía la caja después de un envío exitoso. Se compara contra el último
  // envío visto en vez de usar un efecto, para no encadenar renders.
  if (estado.envio && estado.envio !== ultimoEnvio) {
    setUltimoEnvio(estado.envio)
    setTexto('')
  }

  const sugerencias = sugerirRespuestas(texto, respuestas)
  const esNota = modo === 'nota'
  const deshabilitado = !esNota && Boolean(bloqueo)

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/⌘ + Enter envía. Enter solo hace salto de línea: en un mensaje a un
    // huésped, mandar sin querer a mitad de una frase no tiene vuelta atrás.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
    if (e.key === 'Tab' && sugerencias.length > 0) {
      e.preventDefault()
      setTexto(aplicarVariables(sugerencias[0].contenido, variables))
    }
  }

  return (
    <form action={accion} className="border-t border-stone-200 bg-white px-4 py-3">
      <input type="hidden" name="conversacion_id" value={conversacionId} />
      <input type="hidden" name="modo" value={modo} />

      <div className="mb-2 flex flex-wrap items-center gap-1" role="tablist" aria-label="Tipo de mensaje">
        <button
          type="button"
          role="tab"
          aria-selected={!esNota}
          onClick={() => setModo('respuesta')}
          className={`toque rounded-lg px-3 py-1.5 text-sm font-medium ${!esNota ? 'bg-lago-700 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
        >
          Responder por {canal}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={esNota}
          onClick={() => setModo('nota')}
          className={`toque rounded-lg px-3 py-1.5 text-sm font-medium ${esNota ? 'bg-lenga-600 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
        >
          Nota privada
        </button>
      </div>

      {deshabilitado && (
        <p className="mb-2 rounded-lg bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200" role="status">
          {bloqueo} Podés dejar una nota privada para el equipo.
        </p>
      )}
      {estado.error && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200" role="alert">
          {estado.error}
        </p>
      )}
      {estado.aviso && (
        <p className="mb-2 rounded-lg bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200" role="status">
          {estado.aviso}
        </p>
      )}

      {sugerencias.length > 0 && (
        <ul className="mb-2 overflow-hidden rounded-lg border border-stone-200" aria-label="Respuestas guardadas">
          {sugerencias.map((r) => (
            <li key={r.atajo}>
              <button
                type="button"
                onClick={() => setTexto(aplicarVariables(r.contenido, variables))}
                className="toque block w-full px-3 py-2 text-left text-sm hover:bg-lago-50"
              >
                <span className="font-mono text-xs text-lago-700">/{r.atajo}</span>{' '}
                <span className="text-stone-700">{r.contenido.slice(0, 90)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="sr-only" htmlFor={`texto-${conversacionId}`}>
        {esNota ? 'Nota privada' : 'Respuesta al huésped'}
      </label>
      <textarea
        id={`texto-${conversacionId}`}
        name="texto"
        rows={3}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={alTeclear}
        disabled={deshabilitado || enviando}
        maxLength={4000}
        placeholder={esNota ? 'Sólo la ve el equipo del hotel.' : 'Escribí la respuesta. «/» para respuestas guardadas.'}
        className={`w-full resize-y rounded-lg border px-3 py-2 text-stone-800 outline-none transition focus:border-lago-600 disabled:bg-stone-100 ${esNota ? 'border-lenga-300 bg-lenga-50' : 'border-stone-300 bg-white'}`}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-stone-500">Ctrl + Enter para enviar</p>
        <button
          type="submit"
          disabled={deshabilitado || enviando || !texto.trim()}
          className={botonClases(esNota ? 'secundario' : 'primario', 'w-full sm:w-auto')}
        >
          {enviando ? 'Enviando…' : esNota ? 'Guardar nota' : 'Enviar'}
        </button>
      </div>
    </form>
  )
}
