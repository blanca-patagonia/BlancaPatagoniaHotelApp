'use client'

import { botonClases } from '../_components/ui'

/**
 * Mismo patrón que `app/panel/reservas/[id]/factura/boton-imprimir.tsx`.
 *
 * El proyecto no genera PDF con una librería: abre el diálogo de impresión del
 * navegador, desde donde «Guardar como PDF» está siempre disponible. Es una
 * dependencia menos, funciona sin conexión, y quien imprime en papel —que en un
 * mostrador es lo habitual— no tiene que descargar nada primero.
 */
export function BotonImprimir({ texto = 'Imprimir / Guardar PDF' }: { texto?: string }) {
  return (
    <button onClick={() => window.print()} className={botonClases('primario', 'print:hidden')}>
      {texto}
    </button>
  )
}
