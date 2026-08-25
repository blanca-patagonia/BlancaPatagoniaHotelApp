'use client'

import type { ReactNode } from 'react'
import { Icono } from './iconos'
import { guardarPreferencia, usePreferencia } from './preferencias'

/**
 * Tarjeta con encabezado plegable.
 *
 * ⚠️ Leer antes de usarla. `CLAUDE.md` fija un principio del usuario —«nada
 * oculto, pensado para gente que no usa mucho la computadora»— y prohíbe
 * `<details>` para esconder una acción o un formulario; se eliminaron los 11
 * que había. Esto NO lo contradice, y la diferencia está en tres decisiones:
 *
 *  1. **Arranca desplegada.** Nada nace escondido. El estado plegado es una
 *     elección de quien usa el sistema, no un default del diseño.
 *  2. **El control se ve como un control.** Un `<button>` con chevron, foco
 *     visible y `aria-expanded`. El problema de los `<details>` que se sacaron
 *     era que *parecían un título*: no había forma de saber que había algo
 *     detrás.
 *  3. **Las acciones del encabezado quedan afuera del botón** y siguen
 *     visibles con la tarjeta plegada. Plegar oculta la lectura, nunca el
 *     camino para hacer algo.
 *
 * Por qué existe: Configuración es una sola página de más de 800 líneas con
 * cinco bloques largos. Para llegar al quinto había que pasar por los cuatro
 * anteriores, todos los días. Plegar lo que uno ya no toca convierte esa
 * pantalla en una lista corta.
 *
 * El cuerpo se renderiza SIEMPRE en el servidor: `children` llega ya armado, y
 * plegar solo lo oculta. No es una optimización de carga, es de lectura.
 */
export function TarjetaPlegable({
  id,
  titulo,
  descripcion,
  acciones,
  children,
  className = '',
}: {
  /** Identifica la sección para recordar su estado. Estable entre despliegues. */
  id: string
  titulo: string
  descripcion?: string
  acciones?: ReactNode
  children: ReactNode
  className?: string
}) {
  const clave = `${CLAVE}${id}`
  const abierto = usePreferencia(clave, true)

  const idCuerpo = `plegable-${id}`

  return (
    <section className={`rounded-2xl border border-stone-200 bg-white shadow-sm ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h2>
            <button
              type="button"
              onClick={() => guardarPreferencia(clave, !abierto)}
              aria-expanded={abierto}
              aria-controls={idCuerpo}
              className="toque group flex w-full items-center gap-2 rounded-lg text-left transition"
            >
              <span
                aria-hidden="true"
                className={`shrink-0 text-stone-400 transition-transform duration-150 group-hover:text-stone-600 ${
                  abierto ? 'rotate-90' : ''
                }`}
              >
                <Icono nombre="siguiente" tam={14} />
              </span>
              <span className="min-w-0 font-display text-base font-semibold break-words text-stone-900">
                {titulo}
              </span>
              {/* Con la tarjeta plegada se dice que hay algo debajo. Sin esto,
                  plegar la deja indistinguible de una sección vacía. */}
              {!abierto && (
                <span className="shrink-0 text-xs font-normal text-stone-500">(plegada)</span>
              )}
            </button>
          </h2>
          {descripcion && (
            <p className="mt-0.5 pl-6 text-xs break-words text-stone-500">{descripcion}</p>
          )}
        </div>
        {/* Fuera del botón: anidar un enlace dentro de un `<button>` es HTML
            inválido, y además estas acciones tienen que seguir al alcance con
            la tarjeta plegada. */}
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </header>
      <div id={idCuerpo} hidden={!abierto}>
        {children}
      </div>
    </section>
  )
}

const CLAVE = 'panel:plegado:'
