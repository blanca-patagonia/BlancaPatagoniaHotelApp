'use client'

import { botonClases } from '../../../_components/ui'

export function BotonImprimir() {
  return (
    <button onClick={() => window.print()} className={botonClases('primario', 'print:hidden')}>
      Imprimir / Guardar PDF
    </button>
  )
}
