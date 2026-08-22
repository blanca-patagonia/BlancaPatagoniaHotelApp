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
  /**
   * `hero` para la pantalla de detalle · `resultado` para la tarjeta ancha del
   * buscador, donde la foto ocupa la columna izquierda y tiene que llenarla.
   */
  alto?: 'tarjeta' | 'hero' | 'resultado'
}) {
  const foto = fotoDe(codigo)
  const clases = {
    hero: 'h-56 sm:h-80',
    resultado: 'h-44 sm:h-full sm:min-h-44',
    tarjeta: 'h-40',
  }[alto]

  if (foto) {
    return (
      <div className={`relative w-full shrink-0 overflow-hidden bg-stone-100 ${clases}`}>
        <Image
          src={foto}
          alt={`${nombre} — ${ETIQUETAS_CATEGORIA[categoria]}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          /* Microinteracción: el acercamiento al pasar el mouse confirma que la
             tarjeta entera es un enlace. Es de 3 % y de 300 ms a propósito —lo
             suficiente para notarse, no tanto como para distraer— y
             `prefers-reduced-motion` ya lo desactiva desde `globals.css`. */
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>
    )
  }

  return (
    <div
      className={`flex w-full shrink-0 flex-col items-center justify-center gap-2 bg-linear-to-br from-lago-100 via-lago-50 to-stone-100 ${clases}`}
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
