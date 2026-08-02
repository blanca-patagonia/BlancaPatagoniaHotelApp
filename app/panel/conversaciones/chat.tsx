'use client'

import { useEffect, useRef, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { agrupaConAnterior } from '@/lib/domain/conversaciones'
import { enviarMensaje } from './actions'

/**
 * Panel de mensajes de un canal, con actualización en vivo.
 *
 * Es la única parte del panel que necesita JavaScript en el cliente: sin
 * Realtime habría que recargar para ver lo que escriben los compañeros, y eso
 * no es un chat. El render inicial igual viene del servidor, así que la
 * conversación se ve aunque el WebSocket no llegue a conectar.
 */

export interface MensajeVista {
  id: string
  cuerpo: string
  autor_id: string | null
  creado_en: string
}

interface Props {
  canalId: string
  usuarioId: string
  /** Mensajes ya renderizados por el servidor (del más viejo al más nuevo). */
  iniciales: MensajeVista[]
  /** Nombres del staff, para no consultar el perfil por cada mensaje. */
  nombres: Record<string, string>
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export function Chat({ canalId, usuarioId, iniciales, nombres }: Props) {
  const [mensajes, setMensajes] = useState<MensajeVista[]>(iniciales)
  const finRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Al cambiar de canal NO se sincroniza el estado con un efecto: el padre pasa
  // `key={canal.id}`, así React remonta el componente y `useState` vuelve a
  // arrancar de los mensajes nuevos. Evita el render en cascada.

  // Suscripción a los mensajes nuevos del canal.
  useEffect(() => {
    const supabase = crearClienteNavegador()
    const canal = supabase
      .channel(`mensajes-${canalId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensajes', filter: `canal_id=eq.${canalId}` },
        (payload) => {
          const nuevo = payload.new as MensajeVista
          setMensajes((previos) =>
            // El propio mensaje ya puede haber llegado por el re-render del
            // servidor; se descarta el duplicado por id.
            previos.some((m) => m.id === nuevo.id) ? previos : [...previos, nuevo],
          )
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [canalId])

  // Mantiene la vista al pie, como cualquier chat.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' })
  }, [mensajes])

  return (
    <div className="flex h-[28rem] flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        {mensajes.length === 0 && (
          <p className="py-10 text-center text-sm text-stone-400">
            Todavía no hay mensajes en este canal. Escribí el primero.
          </p>
        )}
        {mensajes.map((m, i) => {
          const propio = m.autor_id === usuarioId
          const agrupado = agrupaConAnterior(m, mensajes[i - 1])
          return (
            <div key={m.id} className={`flex flex-col ${propio ? 'items-end' : 'items-start'}`}>
              {!agrupado && (
                <p className={`mt-3 mb-0.5 text-xs text-stone-400 ${propio ? 'text-right' : ''}`}>
                  {propio ? 'Vos' : (nombres[m.autor_id ?? ''] ?? 'Staff')} · {hora(m.creado_en)}
                </p>
              )}
              <p
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line ${
                  propio ? 'bg-lago-700 text-white' : 'bg-stone-100 text-stone-800'
                }`}
              >
                {m.cuerpo}
              </p>
            </div>
          )
        })}
        <div ref={finRef} />
      </div>

      <form
        ref={formRef}
        action={(formData) => {
          formRef.current?.reset()
          return enviarMensaje(formData)
        }}
        className="flex items-center gap-2 border-t border-stone-100 px-5 py-3"
      >
        <input type="hidden" name="canal_id" value={canalId} />
        <input
          name="cuerpo"
          required
          autoComplete="off"
          placeholder="Escribí un mensaje…"
          aria-label="Mensaje"
          className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600"
        />
        <button className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800">
          Enviar
        </button>
      </form>
    </div>
  )
}
