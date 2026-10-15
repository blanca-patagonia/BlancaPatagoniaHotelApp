'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'

/*
  Galería de fotos de un alojamiento, con flechas.

  ── Por qué deslizamiento nativo y no un carrusel armado a mano ──────────────
  La tira es un contenedor con `scroll-snap`: en el teléfono se pasa con el
  dedo como cualquier galería del sistema —inercia incluida— y en la
  computadora con las flechas, el trackpad o el teclado. Las flechas sólo
  llaman a `scrollBy`; no hay un índice que pueda desincronizarse de lo que se
  ve, porque el número de foto se deduce de la posición real del scroll.

  ── Nada oculto ──────────────────────────────────────────────────────────────
  Las flechas están siempre visibles (no aparecen sólo al pasar el mouse, que
  en un teléfono no existe) y el contador dice cuántas fotos hay.
*/

interface Foto {
  src: string
  alt: string
}

export function Galeria({
  fotos,
  textos,
}: {
  fotos: Foto[]
  textos: { anterior: string; siguiente: string; fotoN: string }
}) {
  const tira = useRef<HTMLDivElement>(null)
  const [actual, setActual] = useState(0)

  const mover = (paso: 1 | -1) => {
    const el = tira.current
    if (!el) return
    el.scrollBy({ left: paso * el.clientWidth, behavior: 'smooth' })
  }

  const alDesplazar = () => {
    const el = tira.current
    if (!el || el.clientWidth === 0) return
    setActual(Math.round(el.scrollLeft / el.clientWidth))
  }

  const contador = textos.fotoN
    .replace('{n}', String(actual + 1))
    .replace('{total}', String(fotos.length))

  return (
    <div className="group/galeria relative h-full min-h-72 overflow-hidden bg-hueso sm:min-h-96">
      <div
        ref={tira}
        onScroll={alDesplazar}
        tabIndex={0}
        aria-label={contador}
        className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {fotos.map((f, i) => (
          <div key={f.src} className="relative h-full min-h-72 w-full shrink-0 snap-start sm:min-h-96">
            <Image
              src={f.src}
              alt={f.alt}
              fill
              priority={i === 0}
              sizes="(min-width: 1024px) 55vw, 100vw"
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {fotos.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => mover(-1)}
            disabled={actual === 0}
            aria-label={textos.anterior}
            className="toque absolute top-1/2 left-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-tinta shadow-md backdrop-blur transition hover:bg-white active:scale-95 disabled:opacity-0"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => mover(1)}
            disabled={actual >= fotos.length - 1}
            aria-label={textos.siguiente}
            className="toque absolute top-1/2 right-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-tinta shadow-md backdrop-blur transition hover:bg-white active:scale-95 disabled:opacity-0"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Puntos + contador. El contador es el que lee el lector de
              pantalla; los puntos son la pista visual. */}
          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5" aria-hidden="true">
            {fotos.map((f, i) => (
              <span
                key={f.src}
                className={`h-1.5 rounded-full bg-white shadow transition-all duration-300 ${
                  i === actual ? 'w-5 opacity-100' : 'w-1.5 opacity-60'
                }`}
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            {contador}
          </p>
        </>
      )}
    </div>
  )
}
