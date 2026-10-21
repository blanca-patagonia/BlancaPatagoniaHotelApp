import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { esDireccion } from '@/lib/domain/permisos'
import { Encabezado, Pagina, Tarjeta } from '../../../_components/ui'
import { FormularioPromocion } from './formulario'

/**
 * Alta de una promoción en su propia pantalla (regla de la Fase 15). Antes el
 * formulario estaba arriba de la tabla y un error lo vaciaba.
 */
export default async function NuevaPromocionPage() {
  const sesion = await requerirAcceso('config')
  if (!esDireccion(sesion.rol)) redirect('/panel/config/promociones')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/config/promociones"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a promociones
      </Link>

      <Encabezado
        titulo="Nueva promoción"
        descripcion="Un descuento por código (por ejemplo para una agencia o una campaña). Se aplica al reservar si cumple sus condiciones."
        icono="config"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioPromocion />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
