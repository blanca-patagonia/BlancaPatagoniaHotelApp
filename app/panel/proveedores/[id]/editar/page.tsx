import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  CAMPO,
  Campo,
  Encabezado,
  Pagina,
  PieDeFormulario,
  Tarjeta,
  botonClases,
} from '../../../_components/ui'
import { BotonEnvio } from '../../../_components/boton-envio'
import { actualizarProveedor, alternarActivoProveedor } from '../../actions'

interface Proveedor {
  id: string
  nombre: string
  rubro: string | null
  cuit: string | null
  email: string | null
  telefono: string | null
  activo: boolean
}

/** Edición de un proveedor, en su propia pantalla. */
export default async function EditarProveedorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const sesion = await requerirAcceso('proveedores')
  const { id } = await params
  if (!['admin', 'gerencia'].includes(sesion.rol)) redirect(`/panel/proveedores/${id}`)

  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('proveedores')
    .select('id, nombre, rubro, cuit, email, telefono, activo')
    .eq('id', id)
    .single()

  if (!data) notFound()
  const proveedor = data as Proveedor

  return (
    <Pagina ancho="angosto">
      <Link
        href={`/panel/proveedores/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a la cuenta
      </Link>

      <Encabezado titulo="Editar proveedor" descripcion={proveedor.nombre} icono="proveedores" />

      <Tarjeta titulo="Datos del proveedor">
        <form
          action={actualizarProveedor}
          className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2 sm:p-6"
        >
          <input type="hidden" name="proveedor_id" value={proveedor.id} />

          <Campo etiqueta="Nombre" requerido>
            <input name="nombre" required defaultValue={proveedor.nombre} className={CAMPO} />
          </Campo>

          <Campo etiqueta="Rubro" ayuda="Con qué nos provee. Sirve para agrupar los gastos.">
            <input name="rubro" defaultValue={proveedor.rubro ?? ''} className={CAMPO} />
          </Campo>

          <Campo etiqueta="CUIT">
            <input name="cuit" defaultValue={proveedor.cuit ?? ''} className={CAMPO} />
          </Campo>

          <Campo etiqueta="Email">
            <input
              name="email"
              type="email"
              defaultValue={proveedor.email ?? ''}
              className={CAMPO}
            />
          </Campo>

          <Campo etiqueta="Teléfono">
            <input
              name="telefono"
              type="tel"
              defaultValue={proveedor.telefono ?? ''}
              className={CAMPO}
            />
          </Campo>

          <PieDeFormulario>
            <BotonEnvio extra="w-full sm:w-auto">Guardar cambios</BotonEnvio>
            <Link
              href={`/panel/proveedores/${id}`}
              className={botonClases('secundario', 'w-full sm:w-auto')}
            >
              Cancelar
            </Link>
          </PieDeFormulario>
        </form>
      </Tarjeta>

      <div className="mt-4">
        <Tarjeta
          titulo={proveedor.activo ? 'Dar de baja' : 'Reactivar'}
          descripcion={
            proveedor.activo
              ? 'Un proveedor dado de baja deja de ofrecerse al cargar gastos. Su historial se conserva.'
              : 'Vuelve a estar disponible para cargarle comprobantes.'
          }
        >
          <form action={alternarActivoProveedor} className="p-5">
            <input type="hidden" name="proveedor_id" value={proveedor.id} />
            <input type="hidden" name="activo" value={String(proveedor.activo)} />
            <BotonEnvio
              variante={proveedor.activo ? 'peligro' : 'secundario'}
              cargando="Aplicando…"
              confirmar={
                proveedor.activo
                  ? `¿Dar de baja a ${proveedor.nombre}? Dejará de aparecer al cargar gastos.`
                  : undefined
              }
            >
              {proveedor.activo ? 'Dar de baja el proveedor' : 'Reactivar el proveedor'}
            </BotonEnvio>
          </form>
        </Tarjeta>
      </div>
    </Pagina>
  )
}
