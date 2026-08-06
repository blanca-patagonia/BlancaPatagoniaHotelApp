import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'
import { FormularioOrden } from '../formulario'

/** Alta de una orden de trabajo, en su propia pantalla. */
export default async function NuevaOrdenPage() {
  await requerirAcceso('mantenimiento')
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('unidades')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre')

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/mantenimiento"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a mantenimiento
      </Link>

      <Encabezado
        titulo="Crear una orden de trabajo"
        descripcion="Queda pendiente hasta que alguien la tome."
        icono="mantenimiento"
      />

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioOrden unidades={(data ?? []) as { id: string; nombre: string }[]} />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
