'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icono } from './iconos'
import { Girador } from './boton-envio'

/**
 * Buscador global del encabezado: combobox con resultados en vivo.
 *
 * ── Por qué combobox y no una lista suelta ──────────────────────────────────
 *
 * Es el patrón WAI-ARIA para "escribís y aparecen sugerencias": el `<input>`
 * lleva `role="combobox"` + `aria-expanded` + `aria-controls` +
 * `aria-activedescendant`, y las opciones viven en un `<ul role="listbox">`
 * aparte. Sin esto, un lector de pantalla no tiene forma de anunciar que hay
 * una lista abierta ni cuál de las opciones está resaltada — la sugerencia
 * visual (el resaltado con el mouse o las flechas) sería puramente visual.
 *
 * ── Por qué sigue siendo un `<form>` de verdad ──────────────────────────────
 *
 * Antes de que el JS cargue (o si falla), Enter tiene que seguir mandando a
 * `/panel/buscar?q=...` — la página completa, que existe independientemente
 * de este componente y usa la MISMA consulta (`buscarGlobal`, compartida con
 * este combobox vía `/api/buscar`). El combobox es una mejora progresiva
 * encima de ese formulario, no un reemplazo.
 *
 * ── Qué se muestra mientras se espera ──────────────────────────────────────
 *
 * Los resultados VIEJOS se quedan en pantalla hasta que llegan los nuevos —
 * nunca se limpia la lista por un fetch en curso—, con un `Girador` chico al
 * lado del ícono de lupa como única señal de que hay una consulta en
 * camino. Es el mismo criterio que ya usa el refresco de la cotización: un
 * componente que parpadea a vacío cada vez que se teclea una letra es peor
 * que uno que tarda un instante en confirmar el cambio.
 */

interface Opcion {
  id: string
  href: string
  titulo: string
  detalle?: string
  etiqueta?: string
}

interface RespuestaBusqueda {
  termino: string | null
  total: number
  secciones: Opcion[]
  glosario: Opcion[]
  reservas: Opcion[]
  huespedes: Opcion[]
  agencias: Opcion[]
  proveedores: Opcion[]
}

interface Grupo {
  titulo: string
  opciones: Opcion[]
}

const DEBOUNCE_MS = 250
const MINIMO_CARACTERES = 2

function grupos(r: RespuestaBusqueda | null): Grupo[] {
  if (!r) return []
  return [
    { titulo: 'Secciones del sistema', opciones: r.secciones },
    { titulo: 'Qué significa', opciones: r.glosario },
    { titulo: 'Reservas', opciones: r.reservas },
    { titulo: 'Huéspedes', opciones: r.huespedes },
    { titulo: 'Agencias y empresas', opciones: r.agencias },
    { titulo: 'Proveedores', opciones: r.proveedores },
  ].filter((g) => g.opciones.length > 0)
}

export function BuscadorGlobal() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<RespuestaBusqueda | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const [indiceActivo, setIndiceActivo] = useState(-1)

  const refContenedor = useRef<HTMLDivElement>(null)
  const refInput = useRef<HTMLInputElement>(null)
  const refTimeout = useRef<number | null>(null)
  const refControlador = useRef<AbortController | null>(null)

  const gruposActuales = useMemo(() => grupos(resultados), [resultados])
  const planas = useMemo(() => gruposActuales.flatMap((g) => g.opciones), [gruposActuales])
  const hrefVerTodos = `/panel/buscar?q=${encodeURIComponent(q.trim())}`

  /*
    Debounce + fetch, disparado desde el `onChange` del input y no desde un
    `useEffect`.

    Es a propósito: lo que dispara esto es una acción de quien está
    escribiendo, no un estado externo que haya que sincronizar (que es para
    lo que son los efectos — ver `pwa.tsx`). Ponerlo en un efecto obligaría a
    llamar `setState` de forma síncrona en el cuerpo del efecto para el caso
    "todavía es muy corto", que es exactamente el patrón que el linter del
    proyecto ya corta en seco (`react-hooks/set-state-in-effect`) porque
    dispara una cascada de renders.
  */
  function buscar(valor: string) {
    setQ(valor)

    if (refTimeout.current !== null) window.clearTimeout(refTimeout.current)
    refControlador.current?.abort()

    const termino = valor.trim()
    if (termino.length < MINIMO_CARACTERES) {
      setResultados(null)
      setAbierto(false)
      setCargando(false)
      setError(false)
      return
    }

    setCargando(true)
    setError(false)
    refTimeout.current = window.setTimeout(() => {
      const controlador = new AbortController()
      refControlador.current = controlador
      fetch(`/api/buscar?q=${encodeURIComponent(termino)}`, {
        signal: controlador.signal,
        cache: 'no-store',
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json() as Promise<RespuestaBusqueda>
        })
        .then((datos) => {
          setResultados(datos)
          setAbierto(true)
          setIndiceActivo(-1)
          setCargando(false)
        })
        .catch((e) => {
          if (e.name === 'AbortError') return
          setError(true)
          setCargando(false)
        })
    }, DEBOUNCE_MS)
  }

  // Limpieza al desmontar: cancela el debounce y el pedido en vuelo. No
  // llama `setState` en el cuerpo del efecto —sólo en el cleanup, al
  // desmontar—, así que no dispara el mismo problema de arriba.
  useEffect(() => {
    return () => {
      if (refTimeout.current !== null) window.clearTimeout(refTimeout.current)
      refControlador.current?.abort()
    }
  }, [])

  // Clic afuera cierra el desplegable, sin borrar lo escrito.
  useEffect(() => {
    if (!abierto) return
    function alTocarAfuera(e: MouseEvent) {
      if (!refContenedor.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', alTocarAfuera)
    return () => document.removeEventListener('mousedown', alTocarAfuera)
  }, [abierto])

  function elegir(href: string) {
    setAbierto(false)
    router.push(href)
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!abierto && resultados) setAbierto(true)
      setIndiceActivo((i) => Math.min(i + 1, planas.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceActivo((i) => Math.max(i - 1, -1))
      return
    }
    if (e.key === 'Escape') {
      setAbierto(false)
      return
    }
    if (e.key === 'Enter' && indiceActivo >= 0 && planas[indiceActivo]) {
      // Con una opción resaltada, Enter va a esa opción y no manda el
      // formulario — si mandara el formulario, iría a buscar el texto tal
      // cual en vez de abrir lo que la persona ya eligió con las flechas.
      e.preventDefault()
      elegir(planas[indiceActivo].href)
      return
    }
    // Sin nada resaltado, Enter sigue su curso normal: envía el <form> y
    // manda a la página completa de resultados. Es el camino sin JS.
  }

  const idActivo = indiceActivo >= 0 ? planas[indiceActivo]?.id : undefined

  return (
    <form action="/panel/buscar" method="get" className="min-w-0 w-full max-w-md flex-1 lg:max-w-lg lg:flex-none">
      <label className="sr-only" htmlFor="busqueda-global">
        Buscar en todo el sistema
      </label>
      <div ref={refContenedor} className="relative">
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-600"
          aria-hidden="true"
        >
          {cargando ? <Girador /> : <Icono nombre="buscar" tam={16} />}
        </span>
        <input
          ref={refInput}
          id="busqueda-global"
          type="search"
          name="q"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={abierto}
          aria-controls="busqueda-global-listbox"
          aria-activedescendant={idActivo}
          value={q}
          onChange={(e) => buscar(e.target.value)}
          onFocus={() => {
            if (resultados) setAbierto(true)
          }}
          onKeyDown={alTeclear}
          placeholder="Buscar huésped, reserva o una sección…"
          className="toque w-full rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-9 text-stone-800 outline-none transition placeholder:text-stone-500 focus:border-lago-600"
        />

        {abierto && (
          <div
            id="busqueda-global-listbox"
            role="listbox"
            aria-label="Resultados de la búsqueda"
            className="absolute top-full left-0 z-40 mt-1 max-h-[70vh] w-full min-w-[320px] overflow-y-auto rounded-xl border border-stone-200 bg-white py-2 shadow-lg"
          >
            {error && (
              <p className="px-4 py-3 text-sm text-red-700">
                No se pudo buscar. Probá de nuevo.
              </p>
            )}

            {!error && resultados && resultados.total === 0 && (
              <p className="px-4 py-3 text-sm text-stone-600">
                No encontramos nada con ese texto. Probá con menos letras.
              </p>
            )}

            {!error &&
              gruposActuales.map((grupo) => (
                <div key={grupo.titulo} className="mb-1 last:mb-0">
                  <p className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                    {grupo.titulo}
                  </p>
                  <ul>
                    {grupo.opciones.map((op) => {
                      const indice = planas.indexOf(op)
                      const activa = indice === indiceActivo
                      return (
                        <li key={op.id}>
                          <Link
                            id={op.id}
                            role="option"
                            aria-selected={activa}
                            href={op.href}
                            onClick={() => setAbierto(false)}
                            onMouseEnter={() => setIndiceActivo(indice)}
                            className={`flex min-h-11 flex-col justify-center px-4 py-1.5 text-sm transition ${
                              activa ? 'bg-lago-50 text-lago-900' : 'text-stone-800 hover:bg-stone-50'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate font-medium">{op.titulo}</span>
                              {op.etiqueta && (
                                <span className="shrink-0 text-xs text-stone-500">{op.etiqueta}</span>
                              )}
                            </span>
                            {op.detalle && (
                              <span className="truncate text-xs text-stone-500">{op.detalle}</span>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}

            {!error && resultados && resultados.total > 0 && (
              <div className="mt-1 border-t border-stone-100 pt-1">
                <Link
                  href={hrefVerTodos}
                  onClick={() => setAbierto(false)}
                  className="block px-4 py-2 text-sm font-medium text-lago-700 hover:bg-stone-50"
                >
                  Ver todos los resultados de «{q.trim()}»
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  )
}
