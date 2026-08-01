'use client'

import { useEffect } from 'react'
import { Icono } from './_components/iconos'

/**
 * Pantalla de error del panel.
 *
 * Sin este archivo, un fallo de red contra Supabase tiraba abajo toda la
 * interfaz. Acá el staff ve un mensaje claro y puede reintentar sin perder la
 * sesión ni volver a navegar desde cero.
 */
export default function ErrorPanel({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Queda en la consola del servidor/navegador para poder diagnosticarlo.
    console.error('Error en el panel:', error)
  }, [error])

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl border border-stone-200 bg-white px-6 py-14 text-center shadow-sm">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <Icono nombre="alerta" tam={24} />
      </span>
      <h1 className="font-display text-xl font-semibold text-stone-900">
        No pudimos cargar esta sección
      </h1>
      <p className="text-sm text-stone-500">
        Puede ser una interrupción momentánea de la conexión con la base de datos. Probá de
        nuevo; si el problema sigue, avisá al administrador del sistema.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-stone-400">Referencia: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-2 rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-lago-800"
      >
        Reintentar
      </button>
    </div>
  )
}
