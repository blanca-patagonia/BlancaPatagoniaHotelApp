import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ETIQUETAS_ESTADO_RESERVA,
  ESTADOS_RESERVA,
  type EstadoReserva,
} from '@/lib/domain/reservas'
import { parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import { BADGE_ESTADO } from '../_components/estilos'

interface Row {
  id: string
  codigo: string
  estado: EstadoReserva
  total: number | string
  canal: string
  huesped: { apellido: string; nombre: string } | null
  estadias: { periodo: string }[]
}

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; grupo?: string }>
}) {
  await requerirAcceso('reservas')
  const { estado: filtro, grupo } = await searchParams
  const supabase = await crearClienteServidor()

  let q = supabase
    .from('reservas')
    .select('id, codigo, estado, total, canal, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre), estadias(periodo)')
    .order('creada_en', { ascending: false })
    .limit(100)
  if (grupo) {
    q = q.eq('grupo_id', grupo)
  } else if (filtro && (ESTADOS_RESERVA as readonly string[]).includes(filtro)) {
    q = q.eq('estado', filtro)
  }
  const { data } = await q
  const reservas = (data ?? []) as unknown as Row[]
  const totalGrupo = grupo ? reservas.reduce((acc, r) => acc + Number(r.total), 0) : 0

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Reservas</h1>
        <div className="flex gap-2">
          <Link
            href="/panel/reservas/nueva-grupo"
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
          >
            + Grupo
          </Link>
          <Link
            href="/panel/reservas/nueva"
            className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-800"
          >
            + Nueva reserva
          </Link>
        </div>
      </div>

      {grupo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm">
          <span className="text-sky-900">Reserva grupal · {reservas.length} unidad(es)</span>
          <span className="font-semibold text-sky-900">
            Total consolidado USD {totalGrupo.toLocaleString('es-AR')}
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5 text-sm">
        <Link
          href="/panel/reservas"
          className={`rounded-full px-3 py-1 ${!filtro ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'}`}
        >
          Todas
        </Link>
        {ESTADOS_RESERVA.map((e) => (
          <Link
            key={e}
            href={`/panel/reservas?estado=${e}`}
            className={`rounded-full px-3 py-1 ${filtro === e ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'}`}
          >
            {ETIQUETAS_ESTADO_RESERVA[e]}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Código</th>
              <th className="px-4 py-2.5">Huésped</th>
              <th className="px-4 py-2.5">Estadía</th>
              <th className="px-4 py-2.5">Canal</th>
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {reservas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-stone-400">
                  Sin reservas todavía.
                </td>
              </tr>
            )}
            {reservas.map((r) => {
              const periodo = r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo) : null
              return (
                <tr key={r.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/panel/reservas/${r.id}`} className="font-medium text-sky-700 hover:underline">
                      {r.codigo}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-stone-700">
                    {r.huesped ? `${r.huesped.apellido}, ${r.huesped.nombre}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">
                    {periodo
                      ? `${formatoFechaCorta(periodo.desde)} → ${formatoFechaCorta(periodo.hasta)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-stone-600 capitalize">{r.canal}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-stone-800">
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
