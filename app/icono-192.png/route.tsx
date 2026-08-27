import { generarIcono } from '@/lib/pwa/icono'

/*
  Ícono de 192 px del manifiesto. Es el tamaño mínimo que exigen los navegadores
  para considerar instalable una aplicación.

  Va como route handler con nombre fijo —y no por la convención `app/icon.tsx`—
  porque el manifiesto necesita una URL **estable**: la convención de Next emite
  `/icon?<hash>`, que cambia con el contenido y no se puede escribir a mano en
  `manifest.ts`.
*/
export function GET() {
  return generarIcono(192)
}
