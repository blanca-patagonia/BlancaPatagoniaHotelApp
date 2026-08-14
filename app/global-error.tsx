'use client'

import { useEffect } from 'react'

/**
 * Último límite de error: cubre los fallos del **layout raíz**.
 *
 * `app/error.tsx` y `app/panel/error.tsx` se renderizan DENTRO del layout, así
 * que no pueden atrapar un error del layout mismo. Cuando eso pasaba —una fuente
 * que no carga, una variable de entorno faltante al construir el cliente de
 * Supabase— el usuario veía la pantalla de error cruda de Next: en inglés, con
 * fondo blanco y sin ninguna salida.
 *
 * Este archivo reemplaza el `<html>` entero, por eso incluye sus propias
 * etiquetas y estilos en línea: en este punto no se puede dar por sentado que
 * la hoja de estilos haya cargado. Escribir Tailwind acá sería apostar a que
 * funcione justo cuando todo lo demás falló.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error en el layout raíz:', error)
  }, [error])

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafaf9',
          color: '#1c1917',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '1rem',
        }}
      >
        <main
          style={{
            maxWidth: '28rem',
            width: '100%',
            background: '#ffffff',
            border: '1px solid #e7e5e4',
            borderRadius: '1rem',
            padding: '3rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            El sistema no está disponible en este momento
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#57534e', margin: '0 0 1.5rem' }}>
            Estamos teniendo un problema técnico. Probá de nuevo en unos minutos.
          </p>

          <button
            onClick={reset}
            style={{
              background: '#136970',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.75rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
              // 44px de alto mínimo, igual que el resto de la interfaz táctil.
              minHeight: '2.75rem',
            }}
          >
            Probar de nuevo
          </button>

          <p style={{ fontSize: '0.75rem', color: '#78716c', margin: '1.5rem 0 0' }}>
            Si necesitás ayuda con una reserva:{' '}
            <a href="mailto:reservas@blancapatagonia.com" style={{ color: '#136970' }}>
              reservas@blancapatagonia.com
            </a>
          </p>

          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#a8a29e', margin: '0.75rem 0 0', fontFamily: 'monospace' }}>
              Referencia: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
