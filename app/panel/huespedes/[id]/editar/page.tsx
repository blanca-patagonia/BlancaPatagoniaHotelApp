import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { Encabezado, Pagina, Tarjeta } from '../../../_components/ui'
import { FormularioHuesped, type DatosHuesped } from '../../formulario'

/**
 * Edición de un huésped en su propia pantalla.
 *
 * La condición frente al IVA se corrige acá, y no al momento de facturar,
 * cuando ya sería tarde: define la letra del comprobante (ADR 0012).
 */
export default async function EditarHuespedPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requerirAcceso('huespedes')
  const { id } = await params
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('huespedes')
    .select(
      'id, apellido, nombre, email, telefono, doc_tipo, doc_numero, nacionalidad, condicion_iva, residente_exterior, notas',
    )
    .eq('id', id)
    .single()

  if (!data) notFound()
  const huesped = data as DatosHuesped

  return (
    <Pagina ancho="angosto">
      <Link
        href={`/panel/huespedes/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a la ficha
      </Link>

      <Encabezado
        titulo="Editar huésped"
        descripcion={`${huesped.apellido}, ${huesped.nombre}`}
        icono="huespedes"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioHuesped huesped={huesped} />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
