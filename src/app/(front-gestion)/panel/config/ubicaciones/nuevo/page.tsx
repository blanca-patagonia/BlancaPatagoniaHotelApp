import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { esDireccion } from '@/lib/domain/permisos'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { Encabezado, Mensaje, Pagina, Tarjeta } from '../../../_components/ui'
import { FormularioUnidad } from './formulario'

/**
 * Alta de una unidad física en su propia pantalla (regla de la Fase 15). Antes
 * el formulario estaba arriba de la tabla de ubicaciones y un error lo vaciaba.
 */
export default async function NuevaUnidadPage() {
  const sesion = await requerirAcceso('config')
  if (!esDireccion(sesion.rol)) redirect('/panel/config/ubicaciones')

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('tipos_unidad')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre')
  registrarFalla(error, 'config:nueva_unidad_tipos')
  const tipos = (data ?? []) as { id: string; nombre: string }[]

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/config/ubicaciones"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a ubicación de las unidades
      </Link>

      <Encabezado
        titulo="Nueva unidad"
        descripcion="Una habitación o cabaña física. Después se le asigna bloque, piso y orden desde la lista."
        icono="config"
      />

      {error ? (
        <Mensaje tono="error">
          No se pudo leer el catálogo de tipos de alojamiento. No se puede crear una unidad hasta que se
          pueda leer: recargá en un momento.
        </Mensaje>
      ) : tipos.length === 0 ? (
        <Mensaje tono="error">
          Todavía no hay tipos de alojamiento activos. Creá uno en «Tipos de alojamiento» antes de cargar
          una unidad.
        </Mensaje>
      ) : (
        <Tarjeta>
          <div className="p-5 sm:p-6">
            <FormularioUnidad tipos={tipos} />
          </div>
        </Tarjeta>
      )}
    </Pagina>
  )
}
