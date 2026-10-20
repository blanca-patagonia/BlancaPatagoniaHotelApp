import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { seniaSugerida } from '@/lib/domain/pagos'
import { diasEntre, formatoFechaCorta } from '@/lib/fechas'
import { formatearUSD } from '@/lib/domain/moneda'
import { FormularioCheckout } from './formulario'
import { Marco, Tarjeta, Titulo } from '../../_publico/ui'

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; check_in?: string; check_out?: string; huespedes?: string }>
}) {
  const sp = await searchParams
  const tipo = String(sp.tipo ?? '')
  const checkIn = RE_FECHA.test(sp.check_in ?? '') ? sp.check_in! : ''
  const checkOut = RE_FECHA.test(sp.check_out ?? '') ? sp.check_out! : ''
  const huespedes = Math.max(1, Number(sp.huespedes ?? 1) || 1)
  if (!tipo || !checkIn || !checkOut || checkOut <= checkIn) notFound()

  const supabase = await crearClienteServidor()
  const { data: tipoData } = await supabase
    .from('tipos_unidad')
    .select('nombre, capacidad_max')
    .eq('id', tipo)
    .single()
  if (!tipoData) notFound()

  const cot = await cotizarEstadia({ tipoUnidadId: tipo, checkIn, checkOut, tarifaTipo: 'rack' })
  const noches = diasEntre(checkIn, checkOut)
  const senia = seniaSugerida(cot.resumen.total, noches)

  return (
    <Marco
      ancho="angosto"
      volver={{
        href: `/reservar?check_in=${checkIn}&check_out=${checkOut}&huespedes=${huespedes}`,
        texto: 'Volver a las opciones',
      }}
    >
      <Titulo
        titulo="Casi listo"
        descripcion="Revisá que esté todo bien y dejanos cómo contactarte."
      />

      {/* El resumen va ARRIBA del formulario: quien está por dar sus datos
          quiere confirmar primero qué está reservando y cuánto sale. */}
      <Tarjeta titulo={(tipoData as { nombre: string }).nombre}>
        <dl className="grid grid-cols-2 gap-5 p-5 sm:p-6">
          <div>
            <dt className="text-sm text-stone-500">Llegada</dt>
            <dd className="mt-0.5 font-medium text-stone-900">{formatoFechaCorta(checkIn)}</dd>
            <dd className="text-sm text-stone-500">desde las 15:00</dd>
          </div>
          <div>
            <dt className="text-sm text-stone-500">Salida</dt>
            <dd className="mt-0.5 font-medium text-stone-900">{formatoFechaCorta(checkOut)}</dd>
            <dd className="text-sm text-stone-500">hasta las 10:00</dd>
          </div>
          <div>
            <dt className="text-sm text-stone-500">Huéspedes</dt>
            <dd className="mt-0.5 font-medium text-stone-900">
              {huespedes} · {noches} {noches === 1 ? 'noche' : 'noches'}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-stone-500">Total</dt>
            <dd className="tabular mt-0.5 font-display text-2xl leading-none font-semibold text-stone-900">
              {formatearUSD(cot.resumen.total)}
            </dd>
            <dd className="text-sm text-stone-500">IVA incluido</dd>
          </div>
          <div className="col-span-2 border-t border-stone-100 pt-4">
            <dt className="text-sm text-stone-500">Seña para tomar la reserva</dt>
            <dd className="tabular mt-0.5 font-medium text-stone-900">
              {formatearUSD(senia)}
              <span className="ml-2 font-normal text-stone-500">
                (equivale a la primera noche)
              </span>
            </dd>
          </div>
        </dl>
      </Tarjeta>

      <div className="mt-4">
        <Tarjeta titulo="Tus datos">
          <div className="p-5 sm:p-6">
            <FormularioCheckout
              tipo={tipo}
              checkIn={checkIn}
              checkOut={checkOut}
              huespedes={huespedes}
            />
          </div>
        </Tarjeta>
      </div>
    </Marco>
  )
}
