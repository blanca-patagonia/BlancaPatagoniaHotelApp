import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { BADGE_ESTADO } from '../../_components/estilos'
import { parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'

interface Huesped {
  id: string
  apellido: string
  nombre: string
  email: string | null
  telefono: string | null
  doc_tipo: string
  doc_numero: string
  nacionalidad: string | null
}
interface ReservaHist {
  id: string
  codigo: string
  estado: EstadoReserva
  total: number | string
  estadias: { periodo: string }[]
}

export default async function DetalleHuespedPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requerirAcceso('huespedes')
  const { id } = await params
  const supabase = await crearClienteServidor()

  const [{ data: huespedData }, { data: reservasData }] = await Promise.all([
    supabase
      .from('huespedes')
      .select('id, apellido, nombre, email, telefono, doc_tipo, doc_numero, nacionalidad')
      .eq('id', id)
      .single(),
    supabase
      .from('reservas')
      .select('id, codigo, estado, total, estadias(periodo)')
      .eq('huesped_id', id)
      .order('creada_en', { ascending: false }),
  ])

  if (!huespedData) notFound()
  const huesped = huespedData as Huesped
  const reservas = (reservasData ?? []) as unknown as ReservaHist[]

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href="/panel/huespedes" className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Huéspedes
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
        {huesped.apellido}, {huesped.nombre}
      </h1>
      <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-stone-500">
        <span>{huesped.doc_tipo} {huesped.doc_numero || '—'}</span>
        <span>{huesped.email || 'sin email'}</span>
        <span>{huesped.nacionalidad || 'nacionalidad n/d'}</span>
      </div>

      <h2 className="mt-6 mb-2 text-sm font-medium text-stone-700">Historial de reservas</h2>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Código</th>
              <th className="px-4 py-2.5">Estadía</th>
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {reservas.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-stone-400">
                  Sin reservas.
                </td>
              </tr>
            )}
            {reservas.map((r) => {
              const p = r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo) : null
              return (
                <tr key={r.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/panel/reservas/${r.id}`} className="font-medium text-sky-700 hover:underline">
                      {r.codigo}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">
                    {p ? `${formatoFechaCorta(p.desde)} → ${formatoFechaCorta(p.hasta)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-stone-800">
                    USD {Number(r.total).toLocaleString('es-AR')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_ESTADO[r.estado]}`}>
                      {ETIQUETAS_ESTADO_RESERVA[r.estado]}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
