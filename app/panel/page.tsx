import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_ACTIVOS } from '@/lib/domain/reservas'
import { ETIQUETAS_ESTADO_HK, ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { hoyISO, parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'

function Kpi({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="text-sm text-stone-500">{titulo}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-stone-900">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-stone-400">{detalle}</p>}
    </div>
  )
}

export default async function DashboardPage() {
  await requerirAcceso('dashboard')
  const supabase = await crearClienteServidor()
  const hoy = hoyISO()

  const [{ data: unidades }, { data: estadias }, { count: reservasActivas }] =
    await Promise.all([
      supabase.from('unidades').select('estado').eq('activo', true),
      supabase.from('estadias').select('periodo, estado').in('estado', [...ESTADOS_ACTIVOS]),
      supabase
        .from('reservas')
        .select('*', { count: 'exact', head: true })
        .in('estado', [...ESTADOS_ACTIVOS]),
    ])

  const totalUnidades = unidades?.length ?? 0
  const porEstado = new Map<EstadoHousekeeping, number>()
  for (const u of unidades ?? []) {
    const e = u.estado as EstadoHousekeeping
    porEstado.set(e, (porEstado.get(e) ?? 0) + 1)
  }

  let ocupadasHoy = 0
  let llegadasHoy = 0
  let salidasHoy = 0
  for (const e of estadias ?? []) {
    const p = parsearPeriodo(e.periodo as string)
    if (hoy >= p.desde && hoy < p.hasta) ocupadasHoy++
    if (p.desde === hoy) llegadasHoy++
    if (p.hasta === hoy) salidasHoy++
  }
  const ocupacionPct = totalUnidades ? Math.round((ocupadasHoy / totalUnidades) * 100) : 0

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Inicio</h1>
          <p className="text-sm text-stone-500">Panorama del día · {formatoFechaCorta(hoy)}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/panel/reservas/nueva"
            className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-800"
          >
            + Nueva reserva
          </Link>
          <Link
            href="/panel/ocupacion"
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
          >
            Ver ocupación
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Ocupación hoy"
          valor={`${ocupacionPct}%`}
          detalle={`${ocupadasHoy} de ${totalUnidades} unidades`}
        />
        <Kpi titulo="Llegadas hoy" valor={String(llegadasHoy)} detalle="check-in previstos" />
        <Kpi titulo="Salidas hoy" valor={String(salidasHoy)} detalle="check-out previstos" />
        <Kpi titulo="Reservas activas" valor={String(reservasActivas ?? 0)} detalle="en curso" />
      </div>

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-medium text-stone-700">Estado de las unidades</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {ESTADOS_HK.map((estado) => (
            <div
              key={estado}
              className="flex items-baseline gap-2 rounded-lg bg-stone-50 px-4 py-2"
            >
              <span className="text-lg font-semibold text-stone-900">
                {porEstado.get(estado) ?? 0}
              </span>
              <span className="text-sm text-stone-500">{ETIQUETAS_ESTADO_HK[estado]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
