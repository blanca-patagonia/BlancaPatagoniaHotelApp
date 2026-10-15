import Image from 'next/image'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import { fotoDe } from '@/lib/domain/catalogo'
import { Montana } from '@/app/_publico/ui'

/**
 * Portada de un alojamiento: la foto si existe, y si no una cabecera de marca.
 *
 * Desde 2026-10-15 **todos los tipos tienen foto real del hotel** (`FOTOS` en
 * `lib/domain/catalogo.ts`, que hasta entonces apuntaba a imágenes de stock de
 * otro hotel). La variante sin imagen se conserva igual, para un tipo nuevo que
 * todavía no tenga la suya: **no es un placeholder**, es un diseño terminado con
 * el degradé y la silueta de la marca. La diferencia importa —un recuadro gris
 * con un ícono de «imagen rota» le dice al huésped que la página está a medio
 * hacer, y de ahí a desconfiar del formulario de reserva hay un paso—.
 *
 * ⚠️ Preferir esta variante antes que poner la foto de otra categoría: publicar
 * una imagen que no es la del tipo que se reserva es prometer lo que no se
 * entrega, y se descubre al abrir la puerta.
 */
export function PortadaAlojamiento({
  codigo,
  nombre,
  categoria,
  alto = 'tarjeta',
  etiquetaCategoria,
}: {
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  /**
   * `hero` para la pantalla de detalle · `resultado` para la tarjeta ancha del
   * buscador, donde la foto ocupa la columna izquierda y tiene que llenarla.
   */
  alto?: 'tarjeta' | 'hero' | 'resultado'
  /** La categoría ya traducida. Sin ella se usa la etiqueta en español. */
  etiquetaCategoria?: string
}) {
  const foto = fotoDe(codigo)
  const categoriaTexto = etiquetaCategoria ?? ETIQUETAS_CATEGORIA[categoria]
  const clases = {
    hero: 'h-56 sm:h-80',
    resultado: 'h-44 sm:h-full sm:min-h-44',
    tarjeta: 'h-40',
  }[alto]

  if (foto) {
    return (
      <div className={`relative w-full shrink-0 overflow-hidden bg-hueso ${clases}`}>
        <Image
          src={foto}
          alt={`${nombre} — ${categoriaTexto}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          /* Microinteracción: el acercamiento al pasar el mouse confirma que la
             tarjeta entera es un enlace. Usa la misma curva exponencial y la
             misma duración larga que la portada —arranca rápido y frena— para
             que las dos pantallas se sientan del mismo sitio.
             `prefers-reduced-motion` ya lo desactiva desde `globals.css`. */
          className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
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
        {categoriaTexto}
      </span>
    </div>
  )
}
