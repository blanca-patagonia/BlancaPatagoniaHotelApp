import { ImageResponse } from 'next/og'
import { COLOR_TEMA } from '@/lib/domain/pwa'

/**
 * Ícono de la aplicación instalable: monograma «BP» sobre el azul de la marca.
 *
 * ── Por qué se genera y no es un archivo ────────────────────────────────────
 *
 * `ImageResponse` ya viene en Next, así que no hace falta ni una dependencia ni
 * commitear cinco PNG que después nadie sabe con qué se hicieron. El día que el
 * hotel pase su logotipo real, se reemplaza esta función y los tamaños siguen
 * saliendo solos.
 *
 * ── Por qué el margen cambia según `maskable` ───────────────────────────────
 *
 * Android recorta el ícono con la forma del lanzador —círculo, cuadrado
 * redondeado, gota— y la especificación garantiza únicamente el **80% central**
 * del lienzo. Un monograma dibujado al tamaño normal pierde los bordes con ese
 * recorte. La versión `maskable` lo dibuja más chico para que entre entero en
 * la zona segura, y el fondo llena todo el lienzo, que es lo que evita el borde
 * blanco cuando el sistema operativo recorta.
 */
export function generarIcono(tamano: number, maskable = false): ImageResponse {
  // Proporción de la tipografía respecto del lienzo. La `maskable` es menor a
  // propósito: ver el encabezado.
  const proporcion = maskable ? 0.38 : 0.52

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: COLOR_TEMA,
          color: '#ffffff',
          fontSize: Math.round(tamano * proporcion),
          fontWeight: 700,
          // Un monograma de dos letras respira mejor apretado; sin esto la «B»
          // y la «P» se leen como dos iniciales sueltas.
          letterSpacing: -Math.round(tamano * 0.02),
        }}
      >
        BP
      </div>
    ),
    { width: tamano, height: tamano },
  )
}
