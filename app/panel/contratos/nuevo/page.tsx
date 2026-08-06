import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'
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
  const sesion = await requerirAcceso('contratos')
  if (!['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel/contratos')

  const supabase = await crearClienteServidor()
  const [{ data: agencias }, { data: proveedores }, { data: empleados }] = await Promise.all([
    supabase.from('agencias').select('id, nombre').order('nombre'),
    supabase.from('proveedores').select('id, nombre').order('nombre'),
    supabase.from('perfiles').select('id, nombre').eq('activo', true).order('nombre'),
  ])

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
