/**
 * Reconocimiento de comodidades del catálogo.
 *
 * Las comodidades de `tipos_unidad.amenities` son texto libre que el hotel
 * escribe en español desde el panel («Vista al Lago Argentino», «WiFi»). El
 * portal necesita dos cosas que el texto solo no da: un ícono para la grilla
 * de la ficha y la traducción para los otros idiomas.
 *
 * Se reconoce por palabras clave y no por igualdad exacta porque el texto lo
 * escribe una persona: «Wi-Fi», «WiFi» y «wifi gratis» son la misma cosa.
 *
 * ⚠️ Una comodidad que no se reconoce **se muestra igual**, con su texto
 * original y un ícono genérico. Nunca se descarta: si el hotel cargó algo, el
 * huésped lo tiene que ver aunque esté en español.
 */

export const CLAVES_COMODIDAD = [
  'vista',
  'hidromasaje',
  'desayuno',
  'wifi',
  'hogar',
  'cocina',
  'calefaccion',
  'tv',
  'estacionamiento',
  'caja',
] as const

export type ClaveComodidad = (typeof CLAVES_COMODIDAD)[number]

/** Palabras que delatan cada comodidad. Se comparan sin tildes ni mayúsculas. */
const PATRONES: Record<ClaveComodidad, RegExp> = {
  vista: /\bvista/,
  hidromasaje: /hidromasaje|jacuzzi|banera/,
  desayuno: /desayuno/,
  wifi: /wi-?fi|internet/,
  hogar: /hogar|chimenea|lena|parrilla/,
  cocina: /cocina/,
  calefaccion: /calefaccion/,
  tv: /\btv\b|television|cable/,
  estacionamiento: /estacionamiento|cochera|parking/,
  caja: /caja de seguridad|caja fuerte/,
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** La clave reconocida de una comodidad, o `null` si no se reconoce. */
export function claveDeComodidad(texto: string): ClaveComodidad | null {
  const limpio = normalizar(texto)
  for (const clave of CLAVES_COMODIDAD) {
    if (PATRONES[clave].test(limpio)) return clave
  }
  return null
}
