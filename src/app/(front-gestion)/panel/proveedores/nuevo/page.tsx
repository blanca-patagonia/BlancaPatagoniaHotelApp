import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'
import { FormularioProveedor } from '../formulario'

/** Alta de proveedor en su propia pantalla (antes plegada dentro del listado). */
export default async function NuevoProveedorPage() {
  await requerirAcceso('proveedores')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/proveedores"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a proveedores
      </Link>

      <Encabezado
        titulo="Registrar un proveedor"
        descripcion="Después vas a poder cargarle facturas y pagos en su cuenta corriente."
        icono="proveedores"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioProveedor />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
