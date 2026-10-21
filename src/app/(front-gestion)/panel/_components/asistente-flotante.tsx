'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Icono } from './iconos'
import { ChatIA } from '../ia/chat'

/**
 * El asistente de IA a mano en cualquier pantalla del panel.
 *
 * Un botón fijo abajo a la derecha abre un panel lateral con el mismo chat de
 * `/panel/ia`. La diferencia es que acá el chat sabe desde qué pantalla se lo
 * abrió (`pantalla`): «¿qué significa este número?» se entiende sin explicar
 * dónde se está.
 *
 * Lo monta el layout sólo para los roles con acceso al área `ia` y sólo si hay
 * proveedor configurado: sin eso, un botón que lleva a «no está configurado»
 * es ruido en todas las pantallas.
 *
 * La conversación se recuerda en la pestaña (`persistir`) al cerrar el panel o
 * cambiar de pantalla: preguntar algo en Reservas y seguir en la ficha es el uso
 * normal. Se borra con «Nueva conversación» o al cerrar la pestaña. El chat se
 * monta recién al abrir el panel, así que leer el storage no choca con la
 * hidratación.
 */
export function AsistenteFlotante({ sugerencias }: { sugerencias: string[] }) {
  const pathname = usePathname()
  const [abierto, setAbierto] = useState(false)

  // Escape cierra el panel, como cualquier diálogo del sistema.
  useEffect(() => {
    if (!abierto) return
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [abierto])

  // En la pantalla propia del asistente el botón sobra.
  if (pathname.startsWith('/panel/ia')) return null

  return (
    <div className="print:hidden">
      {abierto ? (
        <div
          role="dialog"
          aria-label="Asistente IA"
          className="fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-stone-200 bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:h-[36rem] sm:w-[26rem] sm:rounded-2xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <Icono nombre="ia" tam={18} />
              Asistente IA
              <span className="font-normal text-stone-500">· nada se hace sin tu confirmación</span>
            </p>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
              aria-label="Cerrar el asistente"
            >
              <Icono nombre="cerrar" tam={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ChatIA pantalla={pathname} compacto sugerencias={sugerencias} persistir="bp:ia-flotante" />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="fixed right-4 bottom-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full bg-lago-700 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-lago-800"
        >
          <Icono nombre="ia" tam={18} />
          Preguntale a la IA
        </button>
      )}
    </div>
  )
}
