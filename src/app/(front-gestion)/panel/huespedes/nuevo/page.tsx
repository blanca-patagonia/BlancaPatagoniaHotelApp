import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'
import { FormularioHuesped } from '../formulario'

/**
 * Alta de huésped en su propia pantalla.
 *
 * Antes el formulario vivía plegado dentro del listado, en un `<details>` que
 * decía "Registrar un huésped nuevo" y parecía un título: la acción principal
 * del módulo estaba escondida. Una pantalla propia da una sola tarea a la vez,
 * campos anchos y un botón de guardar imposible de no ver.
 */
export default async function NuevoHuespedPage() {
  await requerirAcceso('huespedes')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/huespedes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a huéspedes
      </Link>

      <Encabezado
        titulo="Registrar un huésped"
        descripcion="Cargá los datos de la persona. Después vas a poder crearle reservas."
        icono="huespedes"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioHuesped />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
