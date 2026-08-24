import Link from 'next/link'
import { notFound } from 'next/navigation'
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
import { actualizarAgencia, alternarActivoAgencia } from '../../actions'
import {
  CONDICIONES_IVA,
  ETIQUETAS_CONDICION_IVA,
  type CondicionIva,
} from '@/lib/domain/facturacion'
import { ETIQUETAS_TIPO_CUENTA, type TipoCuenta } from '@/lib/domain/cuentas'

interface Agencia {
  id: string
  nombre: string
  tipo: TipoCuenta
  cuit: string | null
  email: string | null
  telefono: string | null
  descuento_pct: number
  activo: boolean
  condicion_iva: CondicionIva
}

/**
 * Edición de una cuenta corriente, en su propia pantalla.
 *
 * Antes vivía plegada dentro de la ficha, en un `<details>` que decía "Editar
 * datos" y que además metía dos formularios distintos —los datos y el alta/baja—
 * en el mismo bloque.
 */
export default async function EditarAgenciaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requerirAcceso('agencias')
  const { id } = await params

  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('agencias')
    .select('id, nombre, tipo, cuit, email, telefono, descuento_pct, activo, condicion_iva')
    .eq('id', id)
    .single()

  if (!data) notFound()
  const agencia = data as Agencia

  return (
    <Pagina ancho="angosto">
      <Link
        href={`/panel/agencias/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a la cuenta
      </Link>

      <Encabezado
        titulo="Editar cuenta"
        descripcion={`${agencia.nombre} · ${ETIQUETAS_TIPO_CUENTA[agencia.tipo]}`}
        icono="agencias"
      />

      <Tarjeta titulo="Datos de la cuenta">
        <form action={actualizarAgencia} className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2 sm:p-6">
          <input type="hidden" name="agencia_id" value={agencia.id} />

          <Campo etiqueta="Nombre" requerido>
            <input name="nombre" required defaultValue={agencia.nombre} className={CAMPO} />
          </Campo>

          <Campo
            etiqueta="Descuento sobre la tarifa"
            ayuda="Las reservas de esta cuenta se cotizan con tarifa neta usando este porcentaje."
          >
            <div className="flex items-center gap-2">
              <input
                name="descuento_pct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={agencia.descuento_pct}
                className={CAMPO}
              />
              <span className="text-sm text-stone-500">%</span>
            </div>
          </Campo>

          <Campo etiqueta="CUIT" ayuda="Necesario para facturar a nombre de la empresa.">
            <input name="cuit" defaultValue={agencia.cuit ?? ''} className={CAMPO} />
          </Campo>

          <Campo etiqueta="Email" ayuda="A esta dirección llegan los contratos a firmar.">
            <input
              name="email"
              type="email"
              defaultValue={agencia.email ?? ''}
              className={CAMPO}
            />
          </Campo>

          <Campo etiqueta="Teléfono">
            <input
              name="telefono"
              type="tel"
              defaultValue={agencia.telefono ?? ''}
              className={CAMPO}
            />
          </Campo>

          <Campo
            etiqueta="Condición frente al IVA"
            ayuda="Define la letra del comprobante que se le emite."
          >
            <select name="condicion_iva" defaultValue={agencia.condicion_iva} className={CAMPO}>
              {CONDICIONES_IVA.map((c) => (
                <option key={c} value={c}>
                  {ETIQUETAS_CONDICION_IVA[c]}
                </option>
              ))}
            </select>
          </Campo>

          <PieDeFormulario>
            <BotonEnvio extra="w-full sm:w-auto">Guardar cambios</BotonEnvio>
            <Link
              href={`/panel/agencias/${id}`}
              className={botonClases('secundario', 'w-full sm:w-auto')}
            >
              Cancelar
            </Link>
          </PieDeFormulario>
        </form>
      </Tarjeta>

      {/* El alta/baja va en su propio bloque: es una decisión distinta de
          corregir un dato, y conviene que no se confunda con "guardar". */}
      <div className="mt-4">
        <Tarjeta
          titulo={agencia.activo ? 'Dar de baja' : 'Reactivar'}
          descripcion={
            agencia.activo
              ? 'Una cuenta dada de baja deja de ofrecerse al cargar reservas. Su historial se conserva.'
              : 'Vuelve a estar disponible para asociarla a reservas nuevas.'
          }
        >
          <form action={alternarActivoAgencia} className="p-5">
            <input type="hidden" name="agencia_id" value={agencia.id} />
            <input type="hidden" name="activo" value={String(agencia.activo)} />
            <BotonEnvio
              variante={agencia.activo ? 'peligro' : 'secundario'}
              cargando="Aplicando…"
              confirmar={
                agencia.activo
                  ? `¿Dar de baja la cuenta ${agencia.nombre}? Dejará de aparecer al cargar reservas.`
                  : undefined
              }
            >
              {agencia.activo ? 'Dar de baja la cuenta' : 'Reactivar la cuenta'}
            </BotonEnvio>
          </form>
        </Tarjeta>
      </div>
    </Pagina>
  )
}
