import type { MetadataRoute } from 'next'
import {
  ALCANCE_PWA,
  COLOR_FONDO,
  COLOR_TEMA,
  INICIO_PWA,
} from '@/lib/domain/pwa'

/**
 * Manifiesto de la aplicación instalable.
 *
 * ── Por qué está en la raíz si la app es solo el panel ──────────────────────
 *
 * Next enlaza este archivo desde el `<head>` de **todas** las páginas; no hay
 * forma de que lo emita solo para algunas. Eso no es un problema: quien decide
 * dónde se ofrece instalar es `scope`. Con el alcance en `/panel`, el navegador
 * considera que una página pública está **fuera** del manifiesto y no muestra
 * el cartel de instalación. Así que el portal del huésped queda como sitio web
 * —que es lo que corresponde— sin necesidad de un segundo manifiesto.
 *
 * ── Por qué `id` explícito ──────────────────────────────────────────────────
 *
 * Es la identidad de la app para el navegador. Si se omite, se deriva de
 * `start_url`, y el día que `start_url` cambie el navegador va a creer que es
 * otra aplicación distinta: la instalada deja de recibir actualizaciones y
 * aparece una segunda al lado. Fijándolo, `start_url` se puede mover sin
 * romperle el ícono a nadie.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/panel',
    name: 'Blanca Patagonia — Gestión Hotelera',
    // Es lo que entra debajo del ícono en la pantalla de inicio: si no entra,
    // el sistema operativo lo corta con puntos suspensivos.
    short_name: 'Blanca Patagonia',
    description:
      'Gestión del Hotel Blanca Patagonia: reservas, ocupación, housekeeping, consumos y facturación.',
    start_url: INICIO_PWA,
    scope: ALCANCE_PWA,
    display: 'standalone',
    background_color: COLOR_FONDO,
    theme_color: COLOR_TEMA,
    lang: 'es-AR',
    dir: 'ltr',
    // El panel se usa de pie, con una mano, en un pasillo. Nada acá se lee
    // mejor apaisado, y fijarlo evita que la grilla rote sola al caminar.
    orientation: 'portrait',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icono-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icono-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        /*
          El `maskable` es una imagen aparte y no un capricho: Android recorta
          el ícono con la forma que tenga el lanzador (círculo, cuadrado
          redondeado, gota). Sobre el ícono normal ese recorte se come el
          monograma. Éste trae el margen de seguridad que pide la
          especificación, con el dibujo dentro del 80% central.
        */
        src: '/icono-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
