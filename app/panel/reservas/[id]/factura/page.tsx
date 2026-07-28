import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { parsearPeriodo, formatoFechaCorta, diasEntre } from '@/lib/fechas'
import { BotonImprimir } from './boton-imprimir'

interface Reserva {
  codigo: string
  total: number | string
  huesped: {
    apellido: string
    nombre: string
    doc_numero: string
    email: string | null
  } | null
  estadias: {
    periodo: string
    unidad: { nombre: string; tipo: { nombre: string } | null } | null
  }[]
}
interface ConsumoRow {
  cantidad: number
  precio_unitario: number | string
  producto: { nombre: string } | null
}

export default async function FacturaPage({ params }: { params: Promise<{ id: string }> }) {
  await requerirAcceso('reservas')
  const { id } = await params
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('reservas')
    .select(
      'codigo, total, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, doc_numero, email), estadias(periodo, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))',
    )
    .eq('id', id)
    .single()
  if (!data) notFound()
  const reserva = data as unknown as Reserva

  const [{ data: consumosData }, { data: factura }] = await Promise.all([
    supabase
      .from('consumos')
      .select('cantidad, precio_unitario, producto:productos_servicios(nombre)')
      .eq('reserva_id', id)
      .order('creado_en'),
    supabase.from('facturas').select('numero, emitida_en').eq('reserva_id', id).maybeSingle(),
  ])
  const consumos = (consumosData ?? []) as unknown as ConsumoRow[]

  const estadia = reserva.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
  const cuenta = cuentaConsolidada(
    Number(reserva.total),
    consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo),
  )
  const fac = factura as { numero: string; emitida_en: string } | null

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/panel/reservas/${id}`} className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Reserva
        </Link>
        <BotonImprimir />
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-8 print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b border-stone-200 pb-4">
          <div>
            <p className="text-lg font-semibold tracking-tight text-sky-700">Blanca Patagonia</p>
            <p className="text-xs text-stone-500">
              Hostería Boutique &amp; Cabañas · El Calafate, Santa Cruz
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-stone-800">Comprobante interno</p>
            <p className="text-stone-500">{fac?.numero ?? '(proforma)'}</p>
            <p className="text-xs text-stone-400">Reserva {reserva.codigo}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 py-4 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-400">Huésped</p>
            <p className="text-stone-800">
              {reserva.huesped ? `${reserva.huesped.apellido}, ${reserva.huesped.nombre}` : '—'}
            </p>
            <p className="text-stone-500">{reserva.huesped?.doc_numero || ''}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-400">Estadía</p>
            <p className="text-stone-800">
              {estadia?.unidad?.tipo?.nombre ?? estadia?.unidad?.nombre ?? '—'}
            </p>
            <p className="text-stone-500">
              {periodo
                ? `${formatoFechaCorta(periodo.desde)} → ${formatoFechaCorta(periodo.hasta)} (${noches} noches)`
                : ''}
            </p>
          </div>
        </div>

        <table className="w-full border-t border-stone-200 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="py-2">Detalle</th>
              <th className="py-2 text-right">Importe (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-stone-100">
              <td className="py-2 text-stone-700">
                Alojamiento · {estadia?.unidad?.tipo?.nombre ?? ''} ({noches} noches)
              </td>
              <td className="py-2 text-right text-stone-800">
                {cuenta.alojamiento.toLocaleString('es-AR')}
              </td>
            </tr>
            {consumos.map((c, i) => (
              <tr key={i} className="border-t border-stone-100">
                <td className="py-2 text-stone-700">
                  {c.cantidad}× {c.producto?.nombre}
                </td>
                <td className="py-2 text-right text-stone-800">
                  {(c.cantidad * Number(c.precio_unitario)).toLocaleString('es-AR')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-300">
              <td className="py-2 font-semibold text-stone-900">Total</td>
              <td className="py-2 text-right text-lg font-bold text-stone-900">
                USD {cuenta.total.toLocaleString('es-AR')}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-6 border-t border-stone-100 pt-3 text-xs text-stone-400">
          Comprobante interno. No válido como factura fiscal. La facturación
          electrónica (AFIP / CAE) se incorpora en una etapa posterior. Tarifas en
          dólares; IVA incluido en el alojamiento.
        </p>
      </div>
    </div>
  )
}
