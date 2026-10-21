import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { esDireccion } from '@/lib/domain/permisos'
import { Encabezado, Pagina, Tarjeta } from '../../../_components/ui'
import { FormularioTipo } from './formulario'

/**
 * Alta de un tipo de alojamiento en su propia pantalla (regla de la Fase 15:
 * las altas no viven dentro del listado). Antes el formulario estaba arriba
 * de la tabla y, ante un error, lo cargado volvía por la URL.
 */
export default async function NuevoTipoPage() {
  const sesion = await requerirAcceso('config')
  if (!esDireccion(sesion.rol)) redirect('/panel/config/tipos-alojamiento')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/config/tipos-alojamiento"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a tipos de alojamiento
      </Link>

      <Encabezado
        titulo="Nuevo tipo de alojamiento"
        descripcion="Una categoría comercial (por ejemplo «Suite»), no una habitación física. El código queda fijo como clave de las fotos y de los canales de venta."
        icono="config"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioTipo />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
