import { generarIcono } from '@/lib/pwa/icono'

/*
  Versión `maskable`: el mismo monograma, dibujado más chico para que sobreviva
  al recorte con el que Android adapta el ícono a la forma del lanzador. Ver
  `lib/pwa/icono.tsx` para el detalle de la zona segura.
*/
export function GET() {
  return generarIcono(512, true)
}
