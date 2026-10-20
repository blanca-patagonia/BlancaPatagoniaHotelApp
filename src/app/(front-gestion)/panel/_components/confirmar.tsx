'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icono } from './iconos'
import { botonClases } from './ui'

/**
 * Modal de confirmación propio, en reemplazo de `window.confirm`.
 *
 * ── Por qué no alcanza con envolver el diálogo nativo ────────────────────
 *
 * `window.confirm` es **síncrono**: bloquea el hilo hasta que alguien
 * responde, y por eso el código de `BotonEnvio` podía decidir en la misma
 * línea si cancelaba el envío. Un modal propio no puede bloquear nada — se
 * pinta y espera un clic — así que el reemplazo no es "otro texto en el
 * mismo lugar": el que confirma pasa a ser asíncrono en los dos puntos que lo
 * usaban (`BotonEnvio`, `AjustePorcentajeTarifario`), con `preventDefault()`
 * SIEMPRE que hay algo que confirmar, y un `requestSubmit()` recién si la
 * respuesta es que sí.
 *
 * Un solo diálogo a la vez: si `pedir()` se llama mientras ya hay uno
 * abierto, la promesa nueva se resuelve en `false` sin abrir un segundo
 * modal encima — evita que un doble clic accidental deje una promesa
 * colgada para siempre (nadie la resuelve si el modal que la creó ya no
 * existe en pantalla).
 */

interface ContextoConfirmar {
  pedir: (mensaje: string) => Promise<boolean>
}

const Contexto = createContext<ContextoConfirmar | null>(null)

export function useConfirmar(): (mensaje: string) => Promise<boolean> {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error('useConfirmar() necesita <ConfirmarProvider> arriba en el árbol.')
  return ctx.pedir
}

export function ConfirmarProvider({ children }: { children: ReactNode }) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const resolverRef = useRef<((ok: boolean) => void) | null>(null)

  const responder = useCallback((ok: boolean) => {
    setMensaje(null)
    resolverRef.current?.(ok)
    resolverRef.current = null
  }, [])

  const pedir = useCallback(
    (m: string) =>
      new Promise<boolean>((resolve) => {
        if (resolverRef.current) {
          // Ya hay un diálogo abierto: no se apilan, se descarta el segundo.
          resolve(false)
          return
        }
        resolverRef.current = resolve
        setMensaje(m)
      }),
    [],
  )

  useEffect(() => {
    if (!mensaje) return
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') responder(false)
    }
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  }, [mensaje, responder])

  return (
    <Contexto.Provider value={{ pedir }}>
      {children}
      {mensaje && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/50 p-4"
          onClick={() => responder(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirmar acción"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 text-lenga-600">
                <Icono nombre="alerta" tam={20} />
              </span>
              <p className="text-sm text-stone-800">{mensaje}</p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => responder(false)}
                className={botonClases('secundario')}
              >
                Cancelar
              </button>
              <button type="button" onClick={() => responder(true)} className={botonClases('peligro')}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </Contexto.Provider>
  )
}
