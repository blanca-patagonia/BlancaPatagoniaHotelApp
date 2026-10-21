'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Mensaje, botonClases } from '../_components/ui'
import { Icono } from '../_components/iconos'
import { partirRespuesta, type Segmento } from '@/lib/domain/ia-respuesta'
import {
  CAMPOS_EN_TARJETA,
  describirPropuesta,
  esIrreversible,
  type Propuesta,
} from '@/lib/domain/ia-acciones'
import { ejecutarPropuesta } from './acciones'

interface MensajeChat {
  rol: 'user' | 'assistant'
  texto: string
  /** Acciones que el asistente preparó con esta respuesta (ADR 0041). */
  propuestas?: Propuesta[]
}

/** Cuántos mensajes de historial se mandan al servidor (ver `MAX_MENSAJES` en la route). */
const TOPE_HISTORIAL = 20

function Linea({ segmentos }: { segmentos: Segmento[] }) {
  return segmentos.map((s, i) => {
    const contenido = s.negrita ? <strong>{s.texto}</strong> : s.texto
    return s.enlace ? (
      <Link
        key={i}
        href={s.enlace}
        className="font-medium text-lago-700 underline underline-offset-2"
      >
        {contenido}
      </Link>
    ) : (
      <span key={i}>{contenido}</span>
    )
  })
}

/**
 * Una acción que preparó el asistente, esperando confirmación (ADR 0041).
 *
 * Nada se hizo todavía: recién «Confirmar» la ejecuta, con la misma Server
 * Action de la pantalla del módulo. Una vez confirmada o descartada, la tarjeta
 * queda cerrada —no se puede confirmar dos veces—.
 */
function TarjetaPropuesta({ propuesta }: { propuesta: Propuesta }) {
  const [estado, setEstado] = useState<'pendiente' | 'hecha' | 'descartada'>('pendiente')
  const [resultado, setResultado] = useState<{
    ok?: string
    error?: string
    enlace?: string
  } | null>(null)
  const [enviando, iniciar] = useTransition()
  /*
    Los datos de contacto se escriben ACÁ y viajan directo al servidor al
    confirmar: nunca pasan por la IA (ver `CAMPOS_EN_TARJETA`).
  */
  const campos = CAMPOS_EN_TARJETA[propuesta.tipo] ?? []
  // Lo que ya trae la propuesta (el mensaje redactado por la IA) arranca cargado.
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      campos.map((c) => {
        const actual = (propuesta as unknown as Record<string, unknown>)[c.clave]
        return [c.clave, typeof actual === 'string' ? actual : '']
      }),
    ),
  )
  const { titulo, detalle } = describirPropuesta(propuesta)
  const irreversible = esIrreversible(propuesta)

  function confirmar() {
    iniciar(async () => {
      try {
        const r = await ejecutarPropuesta({ ...propuesta, ...valores })
        setResultado(r)
        if (r.ok) setEstado('hecha')
      } catch {
        // Un corte de red no tiene que tirar abajo la pantalla: se dice y se puede reintentar.
        setResultado({ error: 'No se pudo completar. Revisá la conexión y probá de nuevo.' })
      }
    })
  }

  return (
    <div className="mt-2 w-full max-w-[90%] rounded-xl border border-lago-200 bg-lago-50 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-lago-900">
        <Icono nombre="ia" tam={16} />
        {titulo}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-stone-700">
        {detalle.map((d) => (
          <li key={d} className="break-words">
            {d}
          </li>
        ))}
      </ul>
      {campos.length > 0 && estado === 'pendiente' && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {campos.map((c) => (
            <label
              key={c.clave}
              className={`flex min-w-0 flex-col gap-1 text-xs text-stone-600 ${c.largo ? 'sm:col-span-2' : ''}`}
            >
              {c.etiqueta}
              {c.largo ? (
                <textarea
                  value={valores[c.clave] ?? ''}
                  onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
                  rows={6}
                  className="w-full min-w-0 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800"
                />
              ) : (
                <input
                  value={valores[c.clave] ?? ''}
                  onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
                  type={c.clave === 'email' ? 'email' : 'text'}
                  autoComplete="off"
                  className="w-full min-w-0 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800"
                />
              )}
            </label>
          ))}
        </div>
      )}
      {irreversible && estado === 'pendiente' && (
        <p className="mt-2 font-medium text-lenga-800">
          ⚠ No tiene vuelta atrás: revisala antes de confirmar.
        </p>
      )}
      {resultado?.error && (
        <div className="mt-2">
          <Mensaje tono="error">{resultado.error}</Mensaje>
        </div>
      )}
      {estado === 'hecha' ? (
        <div className="mt-2">
          <Mensaje tono="ok">{resultado?.ok ?? 'Hecho.'}</Mensaje>
        </div>
      ) : estado === 'descartada' ? (
        <p className="mt-2 text-stone-500">Descartada: no se hizo nada.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={confirmar}
            disabled={enviando}
            className={botonClases('primario', 'w-auto disabled:cursor-wait disabled:opacity-60')}
          >
            {enviando ? 'Haciéndolo…' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={() => setEstado('descartada')}
            disabled={enviando}
            className={botonClases('secundario', 'w-auto')}
          >
            Descartar
          </button>
        </div>
      )}
      {resultado?.enlace && (
        <Link
          href={resultado.enlace}
          className="mt-2 inline-block font-medium text-lago-700 underline underline-offset-2"
        >
          {estado === 'hecha' ? 'Abrir' : 'Ver el detalle en la pantalla'}
        </Link>
      )}
    </div>
  )
}

/** La respuesta del asistente con negritas y listas (`partirRespuesta`), sin HTML crudo. */
export function Respuesta({ texto }: { texto: string }) {
  return partirRespuesta(texto).map((b, i) =>
    b.tipo === 'lista' ? (
      <ul key={i} className="list-disc space-y-1 pl-5">
        {b.items.map((item, j) => (
          <li key={j}>
            <Linea segmentos={item} />
          </li>
        ))}
      </ul>
    ) : (
      <p key={i}>
        <Linea segmentos={b.segmentos} />
      </p>
    ),
  )
}

/** Indicador circular de progreso, igual al de `BotonEnvio` (no está exportado desde ahí). */
function Girador() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

interface PropsChat {
  /**
   * Ruta desde la que se abrió el chat (el asistente flotante). Le permite al
   * asistente entender «¿qué significa este número?» sin que haya que decirle
   * en qué pantalla se está.
   */
  pantalla?: string
  /** Pregunta que llega armada (p. ej. desde «Analizar con IA»): se carga, no se envía sola. */
  preguntaInicial?: string
  /** Alto completo del contenedor, para el panel lateral. */
  compacto?: boolean
  /** Preguntas de ejemplo para el rol (`preguntasSugeridas`). */
  sugerencias?: string[]
  /**
   * Clave de `sessionStorage` para que la conversación sobreviva a cambiar de
   * pantalla (el asistente flotante). Sólo para componentes que NO se renderizan
   * en el servidor: leer el storage al iniciar el estado rompería la hidratación.
   */
  persistir?: string
}

/** Lo guardado, sin las acciones preparadas (ver `guardar`). */
function leerGuardado(clave: string | undefined): MensajeChat[] {
  if (!clave) return []
  try {
    const crudo = sessionStorage.getItem(clave)
    const datos = crudo ? (JSON.parse(crudo) as unknown) : []
    return Array.isArray(datos)
      ? datos.filter(
          (m): m is MensajeChat =>
            !!m && (m.rol === 'user' || m.rol === 'assistant') && typeof m.texto === 'string',
        )
      : []
  } catch {
    return []
  }
}

/**
 * Guarda la conversación en la pestaña (`sessionStorage`, no `localStorage`: en
 * una computadora compartida de recepción no tiene que sobrevivir a cerrar la
 * pestaña, igual que el borrador del alta de reservas).
 *
 * Las tarjetas de acciones NO se guardan, a propósito: una tarjeta restaurada
 * volvería a ofrecer «Confirmar» sobre algo que quizás ya se hizo, y confirmar
 * dos veces publica dos avisos o carga dos consumos.
 */
function guardar(clave: string | undefined, mensajes: MensajeChat[]) {
  if (!clave) return
  try {
    sessionStorage.setItem(
      clave,
      JSON.stringify(mensajes.slice(-TOPE_HISTORIAL).map(({ rol, texto }) => ({ rol, texto }))),
    )
  } catch {
    // Storage lleno o bloqueado: la conversación sigue, sólo que no se recuerda.
  }
}

export function ChatIA({
  pantalla,
  preguntaInicial = '',
  compacto = false,
  sugerencias = [],
  persistir,
}: PropsChat = {}) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>(() => leerGuardado(persistir))
  const [texto, setTexto] = useState(preguntaInicial)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const finRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' })
  }, [mensajes, enviando])

  useEffect(() => {
    guardar(persistir, mensajes)
  }, [persistir, mensajes])

  function nuevaConversacion() {
    setMensajes([])
    setError(null)
  }

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
          mensajes: historial
            .slice(-TOPE_HISTORIAL)
            .map((m) => ({ rol: m.rol, contenido: m.texto })),
          pantalla,
        }),
      })
      const datos = (await r.json().catch(() => ({}))) as {
        respuesta?: string
        error?: string
        propuestas?: Propuesta[]
      }

      if (!r.ok || datos.error) {
        setError(datos.error ?? 'No se pudo consultar al asistente. Probá de nuevo.')
        return
      }
      setMensajes((previos) => [
        ...previos,
        { rol: 'assistant', texto: datos.respuesta ?? '', propuestas: datos.propuestas ?? [] },
      ])
    } catch {
      setError('No se pudo conectar con el asistente. Revisá la conexión y probá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className={`flex flex-col ${compacto ? 'h-full min-h-0' : 'h-[32rem]'}`}>
      <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        {mensajes.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
            <p className="text-sm text-stone-600">
              Preguntale por los datos del hotel, una reserva, la disponibilidad o cómo se hace algo
              en el sistema.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {sugerencias.map((p) => (
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
              {propio ? (
                <p className="max-w-[85%] rounded-2xl bg-lago-700 px-3.5 py-2 text-sm whitespace-pre-line text-white">
                  {m.texto}
                </p>
              ) : (
                <>
                  <div className="flex max-w-[90%] flex-col gap-2 rounded-2xl bg-stone-100 px-3.5 py-2 text-sm text-stone-800">
                    <Respuesta texto={m.texto} />
                  </div>
                  {m.propuestas?.map((p, j) => (
                    <TarjetaPropuesta key={j} propuesta={p} />
                  ))}
                </>
              )}
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

      {mensajes.length > 0 && !enviando && (
        <div className="flex justify-end px-5 pb-1">
          <button
            type="button"
            onClick={nuevaConversacion}
            className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-800"
          >
            Nueva conversación
          </button>
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
