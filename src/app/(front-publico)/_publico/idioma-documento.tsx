'use client'

import { useEffect } from 'react'

/**
 * Mantiene el `lang` del `<html>` igual al idioma de la pantalla.
 *
 * El layout raíz lo calcula en el servidor, pero Next no lo vuelve a renderizar
 * en una navegación del cliente: al cambiar de `/es` a `/en` con el selector,
 * la página en inglés quedaba marcada como `es-AR` y el lector de pantalla la
 * pronunciaba con reglas del español (WCAG 3.1.1). No dibuja nada.
 */
export function IdiomaDelDocumento({ etiqueta }: { etiqueta: string }) {
  useEffect(() => {
    document.documentElement.lang = etiqueta
  }, [etiqueta])
  return null
}
