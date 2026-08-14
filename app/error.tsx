'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Pantalla de error de las rutas **públicas**: portal de reservas, catálogo,
 * firma de contratos, encuestas y confirmaciones.
 *
 * Hasta acá el único límite de error era `app/panel/error.tsx`, así que todo lo
 * que ve un huésped quedaba sin cubrir: un fallo en `/firmar/[token]` o en
 * `/reservar` mostraba la pantalla por defecto de Next, en inglés y con aspecto
 * de sistema roto.
 *
 * Diferencias deliberadas con la del panel:
 *
 *  · **El tono.** Al staff se le puede decir «avisá al administrador»; a un
 *    huésped hay que darle una salida y un teléfono, porque no tiene a quién
 *    avisarle ni por qué saber qué es Supabase.
 *  · **No se muestra ningún detalle técnico** más allá de la referencia. Un
 *    volcado de error en una pantalla pública es información para quien la esté
 *    sondeando.
 *  · **Es autónoma:** no importa componentes del panel. Si el error vino de un
 *    componente compartido, importarlo acá lo volvería a ejecutar y el límite de
 *    error fallaría también.
 */
export default function ErrorPublico({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error en una ruta pública:', error)
  }, [error])

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-16">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-stone-200 bg-white px-6 py-12 text-center shadow-sm">
        <span
          className="flex size-12 items-center justify-center rounded-2xl bg-lenga-50 text-lenga-600"
          aria-hidden="true"
        >
          {/* SVG en línea y no `<Icono>`: mantiene la pantalla sin dependencias. */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>

        <h1 className="font-display text-xl font-semibold text-stone-900">
          Algo no funcionó como esperábamos
        </h1>

        <p className="text-sm text-stone-600">
          No pudimos mostrarte esta página. Suele ser algo momentáneo: probá de nuevo en unos
          segundos.
        </p>

        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-lg bg-lago-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-lago-800"
          >
            Probar de nuevo
          </button>
          <Link
            href="/"
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            Volver al inicio
          </Link>
        </div>

        <p className="mt-4 border-t border-stone-100 pt-4 text-xs text-stone-500">
          Si necesitás ayuda con una reserva, escribinos a{' '}
          <a href="mailto:reservas@blancapatagonia.com" className="text-lago-700 underline">
            reservas@blancapatagonia.com
          </a>
          .
        </p>

        {/* La referencia sirve para que el equipo encuentre el error en el log. */}
        {error.digest && (
          <p className="font-mono text-xs text-stone-400">Referencia: {error.digest}</p>
        )}
      </div>
    </main>
  )
}
