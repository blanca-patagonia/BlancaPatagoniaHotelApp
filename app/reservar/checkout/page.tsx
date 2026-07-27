import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { seniaSugerida } from '@/lib/domain/pagos'
import { diasEntre, formatoFechaCorta } from '@/lib/fechas'
import { FormularioCheckout } from './formulario'

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
    <main className="flex flex-1 flex-col bg-stone-50">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight text-sky-700">
          Blanca Patagonia
        </Link>
        <Link
          href={`/reservar?check_in=${checkIn}&check_out=${checkOut}&huespedes=${huespedes}`}
          className="text-sm text-stone-500 hover:text-stone-800"
        >
          ← Volver
        </Link>
      </header>

      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Confirmá tu reserva</h1>

        <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-medium text-stone-800">{(tipoData as { nombre: string }).nombre}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-stone-400">Fechas</dt>
              <dd className="text-stone-800">
                {formatoFechaCorta(checkIn)} → {formatoFechaCorta(checkOut)} ({noches}{' '}
                {noches === 1 ? 'noche' : 'noches'})
              </dd>
            </div>
            <div>
              <dt className="text-stone-400">Huéspedes</dt>
              <dd className="text-stone-800">{huespedes}</dd>
            </div>
            <div>
              <dt className="text-stone-400">Total (con IVA)</dt>
              <dd className="text-lg font-semibold text-stone-900">
                USD {cot.resumen.total.toLocaleString('es-AR')}
              </dd>
            </div>
            <div>
              <dt className="text-stone-400">Seña (primera noche)</dt>
              <dd className="text-stone-800">USD {senia.toLocaleString('es-AR')}</dd>
            </div>
          </dl>
        </div>

        <FormularioCheckout
          tipo={tipo}
          checkIn={checkIn}
          checkOut={checkOut}
          huespedes={huespedes}
        />
      </div>
    </main>
  )
}
