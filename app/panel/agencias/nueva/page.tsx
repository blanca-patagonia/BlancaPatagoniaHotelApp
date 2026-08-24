import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'
import { FormularioAgencia } from '../formulario'

/**
 * Alta de agencia o empresa con convenio, en su propia pantalla.
 *
 * El alta la restringe la acción a admin y gerencia; acá se corta antes para no
 * mostrarle a recepción un formulario que el servidor va a rechazar.
 */
export default async function NuevaAgenciaPage() {
  await requerirAcceso('agencias')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/agencias"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a agencias
      </Link>

      <Encabezado
        titulo="Registrar una cuenta"
        descripcion="Agencias de viaje y empresas con convenio. Después vas a poder cargarle cargos y pagos."
        icono="agencias"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioAgencia />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
