import Image from 'next/image'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import { fotoDe } from '@/lib/domain/catalogo'
import { Montana } from '../_publico/ui'

/**
 * Portada de un alojamiento: la foto si existe, y si no una cabecera de marca.
 *
 * El hotel todavía no entregó las fotos, así que la variante sin imagen **no es
 * un placeholder**: es un diseño terminado con el degradé y la silueta de la
 * marca. La diferencia importa —un recuadro gris con un ícono de «imagen rota»
 * le dice al huésped que la página está a medio hacer, y de ahí a desconfiar del
 * formulario de reserva hay un paso—.
 *
 * Cuando lleguen las fotos, alcanza con descomentar la línea del código en
 * `FOTOS` (`lib/domain/catalogo.ts`): esta portada las toma sola.
 */
export function PortadaAlojamiento({
  codigo,
  nombre,
  categoria,
  alto = 'tarjeta',
}: {
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  /** `hero` para la pantalla de detalle, más alta. */
  alto?: 'tarjeta' | 'hero'
}) {
  const foto = fotoDe(codigo)
  const clases = alto === 'hero' ? 'h-56 sm:h-80' : 'h-40'

  if (foto) {
    return (
      <div className={`relative w-full shrink-0 overflow-hidden bg-stone-100 ${clases}`}>
        <Image
          src={foto}
          alt={`${nombre} — ${ETIQUETAS_CATEGORIA[categoria]}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={`flex w-full shrink-0 flex-col items-center justify-center gap-2 bg-gradient-to-br from-lago-100 via-lago-50 to-stone-100 ${clases}`}
    >
      {/* Decorativo: el nombre del alojamiento ya está en el encabezado que
          sigue, así que repetirlo acá solo alargaría el lector de pantalla. */}
      <span className="text-lago-600/60" aria-hidden="true">
        <Montana />
      </span>
      <span className="text-xs font-medium tracking-[0.18em] text-lago-700/80 uppercase">
        {ETIQUETAS_CATEGORIA[categoria]}
      </span>
    </div>
  )
}
