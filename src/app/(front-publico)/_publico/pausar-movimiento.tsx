'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

const CONSULTA = '(prefers-reduced-motion: reduce)'

function suscribir(avisar: () => void) {
  const m = window.matchMedia(CONSULTA)
  m.addEventListener('change', avisar)
  return () => m.removeEventListener('change', avisar)
}

/**
 * Botón para detener todo lo que se mueve solo en la portada (WCAG 2.2.2).
 *
 * El video del hero, la cinta de fotos (70 s en bucle) y el acercamiento lento
 * del video se repetían sin fin y no había forma de pararlos: `prefers-reduced-
 * motion` sólo acorta animaciones de CSS y no frena un `<video>`, y la cinta
 * se pausaba únicamente con el mouse encima. A quien tiene un trastorno
 * vestibular o de atención, eso le impide leer la página.
 *
 * Si la persona pidió menos movimiento en su sistema, arranca en pausa. Pone
 * `data-movimiento="pausado"` en el `<html>` (el CSS detiene las animaciones
 * con eso, ver `globals.css`) y pausa los videos de la página.
 */
export function PausarMovimiento({ pausar, reanudar }: { pausar: string; reanudar: string }) {
  // Estado del navegador por `useSyncExternalStore` (ver AGENTS.md): el tercer
  // argumento es lo que se usa en el servidor, donde no hay `matchMedia`.
  const prefiereQuieto = useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  )
  const [eleccion, setEleccion] = useState<boolean | null>(null)
  const pausado = eleccion ?? prefiereQuieto

  useEffect(() => {
    const raiz = document.documentElement
    if (pausado) raiz.dataset.movimiento = 'pausado'
    else delete raiz.dataset.movimiento
    for (const video of document.querySelectorAll('video')) {
      if (pausado) video.pause()
      else void video.play().catch(() => {})
    }
    return () => {
      delete raiz.dataset.movimiento
    }
  }, [pausado])

  return (
    <button
      type="button"
      onClick={() => setEleccion(!pausado)}
      className="toque inline-flex items-center gap-2 rounded-full bg-stone-950/45 px-3.5 text-xs font-medium text-white/90 backdrop-blur transition hover:bg-stone-950/65 hover:text-white"
    >
      <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true">
        {pausado ? <path d="M8 5.5v13l11-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
      </svg>
      {pausado ? reanudar : pausar}
    </button>
  )
}
