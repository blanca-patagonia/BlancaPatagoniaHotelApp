import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { Encabezado, Pagina, Tarjeta } from '../../../_components/ui'
import { FormularioGasto } from '../formulario'

export default async function NuevoGastoPage() {
  await requerirAcceso('conciliacion')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/conciliacion/gastos"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a gastos
      </Link>

      <Encabezado
        titulo="Registrar gasto"
        descripcion="Sueldos, servicios, mantenimiento sin proveedor formal: todo lo que el hotel paga sin una factura de por medio."
        icono="conciliacion"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioGasto />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
