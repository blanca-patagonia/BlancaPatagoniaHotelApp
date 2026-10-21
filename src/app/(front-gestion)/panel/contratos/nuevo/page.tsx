import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { Encabezado, Mensaje, Pagina, Tarjeta } from '../../_components/ui'
import { registrarFalla } from '@/lib/acciones'
import { FormularioContrato, type OpcionEntidad } from '../formulario'
import type { TipoContrato } from '@/lib/domain/contratos'

/**
 * Redacción de un contrato en su propia pantalla.
 *
 * La contraparte es **polimórfica** (agencia, proveedor o empleado): se traen
 * las tres tablas y se ofrecen agrupadas en un solo selector, con el tipo
 * codificado en el valor. Así el formulario funciona sin JavaScript, sin
 * selects encadenados.
 */
export default async function NuevoContratoPage() {
  await requerirAcceso('contratos')

  const supabase = await crearClienteServidor()
  const [
    { data: agencias, error: eAgencias },
    { data: proveedores, error: eProveedores },
    { data: empleados, error: eEmpleados },
  ] = await Promise.all([
    supabase.from('agencias').select('id, nombre').order('nombre'),
    supabase.from('proveedores').select('id, nombre').order('nombre'),
    supabase.from('perfiles').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  registrarFalla(eAgencias, 'contratos:nuevo_agencias')
  registrarFalla(eProveedores, 'contratos:nuevo_proveedores')
  registrarFalla(eEmpleados, 'contratos:nuevo_empleados')
  // Una lista que no se pudo leer sale vacía en el selector, igual que una
  // tabla sin filas: hay que decir cuál de las dos es.
  const sinLeer = [
    eAgencias && 'agencias',
    eProveedores && 'proveedores',
    eEmpleados && 'empleados',
  ].filter(Boolean)

  const opciones = (
    filas: { id: string; nombre: string }[] | null,
    t: TipoContrato,
  ): OpcionEntidad[] => (filas ?? []).map((f) => ({ valor: `${t}:${f.id}`, nombre: f.nombre }))

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/contratos"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a contratos
      </Link>

      <Encabezado
        titulo="Redactar un contrato"
        descripcion="Se guarda como borrador: vas a poder revisarlo antes de enviarlo a firmar."
        icono="contratos"
      />

      {sinLeer.length > 0 && (
        <Mensaje tono="error">
          No se pudo leer la lista de {sinLeer.join(' ni de ')}: si no aparece la contraparte que
          buscás, no es que no exista. Recargá la página en un momento.
        </Mensaje>
      )}

      <Tarjeta>
        <div className="p-5 sm:p-6">
          <FormularioContrato
            agencias={opciones(agencias as { id: string; nombre: string }[], 'agencia')}
            proveedores={opciones(proveedores as { id: string; nombre: string }[], 'proveedor')}
            empleados={opciones(empleados as { id: string; nombre: string }[], 'empleado')}
          />
        </div>
      </Tarjeta>
    </Pagina>
  )
}
