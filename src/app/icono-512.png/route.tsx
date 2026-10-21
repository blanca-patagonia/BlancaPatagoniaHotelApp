import { generarIcono } from '@/lib/pwa/icono'

/*
  Ícono de 512 px. Es el que usan la pantalla de instalación y el arranque de la
  app; en un teléfono de densidad alta, uno de 192 ampliado se ve borroso.
*/
export function GET() {
  return generarIcono(512)
}
