'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChatAsistente } from '../reservar/_asistente/chat'
import type { Diccionario } from '@/lib/i18n/diccionarios/es'

/**
 * Lanzador flotante del asistente, para la portada.
 *
 * ── Por qué un lanzador y no el chat embebido ───────────────────────────────
 *
 * En `/reservar` el asistente va dentro del flujo de la página, y ahí está
 * bien: quien llegó hasta ahí ya está decidiendo. En la portada el chat
 * ocuparía una pantalla entera de alto compitiendo con las fotos y con el
 * buscador, que es lo que de verdad cierra una reserva.
 *
 * ── Esto NO contradice «nada oculto» ────────────────────────────────────────
 *
 * Esa regla (CLAUDE.md, Fase 15) es del **panel**: prohíbe esconder acciones y
 * formularios de trabajo detrás de un `<details>`, porque quien los usa todos
 * los días tiene que verlos. Acá es distinto en dos cosas: el botón está
 * **siempre visible y rotulado** —no es un ícono suelto— y lo que abre es una
 * ayuda opcional, no el camino para reservar. Ese camino está entero a la
 * vista: el buscador del hero, la sección de alojamientos y el teléfono.
 *
 * El motor sigue siendo el de reglas del ADR 0011. No hay LLM del lado del
 * huésped, a propósito: un modelo que alucina un precio o una disponibilidad
 * genera un reclamo que el hotel tiene que honrar.
 */
export function AsistenteFlotante({
  t,
  consultasEs,
}: {
  t: Diccionario['asistente']
  consultasEs: [string, string, string]
}) {
  const [abierto, setAbierto] = useState(false)
  const idPanel = useId()
  const boton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  /*
    Al abrir, el foco va a la pregunta. Antes el panel quedaba ANTES del botón
    en el documento y el botón era lo último de la página: abrir con Enter y
    seguir con Tab sacaba el foco de la página, y había que volver con
    Shift+Tab sin saberlo (WCAG 2.4.3).
  */
  useEffect(() => {
    if (abierto) panel.current?.querySelector<HTMLInputElement>('input[name="pregunta"]')?.focus()
  }, [abierto])

  /** Escape cierra y devuelve el foco al botón que lo abrió. */
  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    setAbierto(false)
    boton.current?.focus()
  }

  return (
    <>
      <button
        type="button"
        ref={boton}
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls={idPanel}
        className="toque fixed right-4 bottom-4 z-50 inline-flex items-center gap-2 rounded-full bg-lago-700 px-5 text-sm font-semibold text-white shadow-xl transition hover:bg-lago-800 sm:right-6 sm:bottom-6"
      >
        {abierto ? (
          <>
            <span aria-hidden="true" className="text-base leading-none">
              ×
            </span>
            {t.cerrar}
          </>
        ) : (
          <>
            {/* El ícono acompaña, nunca va solo: el rótulo dice qué hace. */}
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.5 12.5c0 3.6-3.8 6.5-8.5 6.5-1 0-2-.1-2.9-.4l-5.1 1.4 1.5-4.2c-1.2-1-1.9-2.4-1.9-3.9C3.6 8.9 7.4 6 12 6s8.5 2.9 8.5 6.5z" />
            </svg>
            {t.abrir}
          </>
        )}
      </button>

      {/*
        El panel se monta sólo cuando se abre y va DESPUÉS del botón, que es
        el orden en que se recorre con el teclado. `ChatAsistente` mantiene la
        conversación en memoria, así que desmontarlo al cerrar descarta lo
        hablado — lo correcto en una computadora compartida, el mismo criterio
        del borrador de reserva.
      */}
      {abierto && (
        <div
          ref={panel}
          id={idPanel}
          onKeyDown={alTeclear}
          className="panel-entra fixed inset-x-4 bottom-24 z-50 sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[25rem]"
        >
          <div className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-tinta/15">
            <ChatAsistente t={t} consultasEs={consultasEs} />
          </div>
        </div>
      )}
    </>
  )
}
