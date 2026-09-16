'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icono } from './iconos'
import { Girador } from './boton-envio'

/**
 * Avisos flotantes propios del sistema (toast), para acciones del cliente que
 * no pasan por un `<form>` de servidor — el caso que `Mensaje`/`ExitoConPasos`
 * no cubren, porque esos dependen de un `redirect` o de un render de servidor.
 *
 * ── Qué NO reemplaza ─────────────────────────────────────────────────────
 *
 * `Mensaje`/`ExitoConPasos` (`ui.tsx`) siguen siendo el camino para el éxito y
 * el error de las Server Actions: decenas de pantallas ya los usan y probaron,
 * y migrarlos no era el pedido. Esto es una capa nueva para lo que antes no
 * tenía ningún aviso: hoy lo usa el refresco automático de la cotización
 * (`cotizacion-cliente.tsx`), que corre solo cada 5 minutos sin que nadie
 * dispare un formulario.
 *
 * ── Tres tonos, cada uno con su regla de cuánto dura ─────────────────────
 *
 *  · `ok`       — 4 s y se va solo.
 *  · `error`    — 8 s: el doble, porque un error no se puede perder tan rápido
 *    como una confirmación. Además tiene botón para cerrarlo a mano.
 *  · `cargando` — no se autodestruye. Queda hasta que quien lo mostró llama
 *    `quitar(id)` (o hasta reemplazarlo por un `ok`/`error`), porque su
 *    sentido es indicar que algo sigue en curso — borrarlo solo mentiría.
 *
 * Nunca se comunica solo con color: cada tono lleva ícono (`ok`, `alerta`, o
 * el `Girador` de `BotonEnvio`) además del texto.
 */

export type TonoAviso = 'ok' | 'error' | 'cargando'

interface Aviso {
  id: number
  tono: TonoAviso
  texto: string
}

interface ContextoAvisos {
  mostrar: (tono: TonoAviso, texto: string) => number
  quitar: (id: number) => void
}

const Contexto = createContext<ContextoAvisos | null>(null)

/** Milisegundos antes de autodestruirse. `cargando` no está: no se autodestruye. */
const DURACION_MS: Record<'ok' | 'error', number> = {
  ok: 4000,
  error: 8000,
}

let contador = 0

export function useAvisos(): ContextoAvisos {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error('useAvisos() necesita <AvisosProvider> arriba en el árbol.')
  return ctx
}

export function AvisosProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const quitar = useCallback((id: number) => {
    setAvisos((prev) => prev.filter((a) => a.id !== id))
    const t = timers.current.get(id)
    if (t !== undefined) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const mostrar = useCallback(
    (tono: TonoAviso, texto: string) => {
      const id = ++contador
      setAvisos((prev) => [...prev, { id, tono, texto }])
      if (tono !== 'cargando') {
        timers.current.set(
          id,
          setTimeout(() => quitar(id), DURACION_MS[tono]),
        )
      }
      return id
    },
    [quitar],
  )

  // Memoizado: sin esto, cada render de `AvisosProvider` —incluido cada
  // aparición o desaparición de un aviso, en cualquier parte del panel— crea
  // un objeto nuevo y dispara de nuevo cualquier `useEffect` que lo tenga
  // como dependencia (ver `cotizacion-cliente.tsx`), aunque `mostrar`/`quitar`
  // en sí no hayan cambiado.
  const valor = useMemo(() => ({ mostrar, quitar }), [mostrar, quitar])

  return (
    <Contexto.Provider value={valor}>
      {children}

      {/* `aria-live="polite"`: un lector de pantalla anuncia el aviso sin
          interrumpir lo que esté leyendo, igual criterio que el resto del
          panel usa para los `Mensaje` en pantalla. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[50] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {avisos.map((a) => (
          <div
            key={a.id}
            role={a.tono === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ${
              a.tono === 'error'
                ? 'bg-red-50 text-red-800 ring-red-200'
                : a.tono === 'cargando'
                  ? 'bg-white text-stone-700 ring-stone-200'
                  : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {a.tono === 'cargando' ? (
                <Girador />
              ) : (
                <Icono nombre={a.tono === 'error' ? 'alerta' : 'ok'} tam={16} />
              )}
            </span>
            <span className="flex-1">{a.texto}</span>
            {a.tono !== 'cargando' && (
              <button
                type="button"
                onClick={() => quitar(a.id)}
                aria-label="Cerrar aviso"
                className="shrink-0 text-current/60 hover:text-current"
              >
                <Icono nombre="cerrar" tam={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Contexto.Provider>
  )
}
