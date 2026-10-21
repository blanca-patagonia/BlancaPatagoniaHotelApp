import { generarIcono } from '@/lib/pwa/icono'

/*
  Ícono para iOS.

  Safari **ignora los `icons` del manifiesto** al agregar a la pantalla de
  inicio: usa `apple-touch-icon`, que es lo que emite esta convención de Next.
  Sin este archivo, un iPhone muestra en el escritorio una miniatura de la
  captura de pantalla en lugar del ícono, y el resultado se ve como un error.

  180 px es el tamaño que pide Apple para las pantallas @3x.
*/
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return generarIcono(180)
}
