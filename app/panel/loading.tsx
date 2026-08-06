import { EsqueletoTablero } from './_components/esqueletos'

/**
 * Esqueleto por defecto del panel: el del tablero de inicio.
 *
 * Las secciones que tienen otra forma —listados, detalles, formularios—
 * declaran su propio `loading.tsx`; este cubre el resto.
 */
export default function Cargando() {
  return <EsqueletoTablero />
}
