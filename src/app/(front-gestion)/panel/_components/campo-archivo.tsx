'use client'

import { useState } from 'react'
import { Campo } from './ui'

/**
 * Campo de archivo con un disparador propio, en vez del `<input type="file">`
 * nativo a secas.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * El texto del botón nativo ("Choose File" / "No file chosen") lo pone el
 * navegador según SU idioma, no el de la página — `<html lang="es">` no lo
 * cambia, es una limitación real de los navegadores actuales. En una
 * interfaz 100% en español, en medio de instrucciones en español, ese inglés
 * suelto confunde. El input real sigue ahí (`sr-only`, participa del
 * `FormData` igual que siempre): lo que cambia es que la etiqueta visible la
 * escribe esta pantalla, no el navegador.
 */
export function CampoArchivo({
  nombre,
  etiqueta,
  ayuda,
  accept,
  requerido,
}: {
  nombre: string
  etiqueta: string
  ayuda?: string
  accept?: string
  requerido?: boolean
}) {
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null)

  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} requerido={requerido}>
      <label className="toque flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition hover:bg-stone-50 focus-within:border-lago-600">
        <span className={`truncate ${nombreArchivo ? 'text-stone-800' : 'text-stone-500'}`}>
          {nombreArchivo ?? 'Ningún archivo elegido'}
        </span>
        <span className="shrink-0 rounded-md bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
          Elegir archivo
        </span>
        <input
          type="file"
          name={nombre}
          accept={accept}
          required={requerido}
          className="sr-only"
          onChange={(e) => setNombreArchivo(e.target.files?.[0]?.name ?? null)}
        />
      </label>
    </Campo>
  )
}
