'use client'

import { useState } from 'react'
import { botonClases } from '../../_components/ui'

/** Un valor para copiar con un toque (una URL, un nombre de variable). */
export function CopiarTexto({ texto, etiqueta = 'Copiar', bloque = false }: { texto: string; etiqueta?: string; bloque?: boolean }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso del portapapeles (ventana no segura): el valor está a la vista y se puede seleccionar.
    }
  }
  return (
    <span className={`flex min-w-0 gap-2 ${bloque ? 'items-start' : 'items-stretch'}`}>
      <code className={`min-w-0 flex-1 rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs select-all ${bloque ? 'whitespace-pre-wrap' : 'break-all'}`}>{texto}</code>
      <button type="button" onClick={copiar} className={botonClases('secundario', 'shrink-0 px-3 py-1.5 text-xs')}>
        {copiado ? '✓ Copiado' : etiqueta}
      </button>
    </span>
  )
}

/**
 * Genera un texto al azar para las claves que INVENTA el hotel (el token de
 * verificación de Meta, el secreto del webhook de Telegram). Se hace en el
 * navegador con `crypto.getRandomValues`: no pasa por el servidor ni se guarda
 * en ningún lado, así que no hace falta abrir una terminal para `openssl`.
 */
export function GeneradorSecreto({ variable, bytes = 16 }: { variable: string; bytes?: number }) {
  const [valor, setValor] = useState<string | null>(null)
  function generar() {
    const a = new Uint8Array(bytes)
    crypto.getRandomValues(a)
    setValor(Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''))
  }
  return (
    <div className="space-y-1.5">
      {valor ? (
        <>
          <CopiarTexto texto={`${variable}=${valor}`} />
          <p className="text-xs text-stone-600">
            Pegalo tal cual en <code>.env.local</code> (o en Vercel), y no lo compartas.
          </p>
        </>
      ) : null}
      <button type="button" onClick={generar} className={botonClases('secundario', 'px-3 py-1.5 text-xs')}>
        {valor ? 'Generar otro' : `Generar ${variable}`}
      </button>
    </div>
  )
}
