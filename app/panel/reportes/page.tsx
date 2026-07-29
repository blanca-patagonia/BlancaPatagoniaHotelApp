import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ESTADOS_RESERVA,
  ETIQUETAS_ESTADO_RESERVA,
  type EstadoReserva,
} from '@/lib/domain/reservas'
import {
  parsearPeriodo,
  nochesEnVentana,
  inicioFinDeMes,
  diasEntre,
  mesActual,
} from '@/lib/fechas'

const RE_MES = /^\d{4}-\d{2}$/
const ESTADOS_NO_VENDIDOS: EstadoReserva[] = ['cancelada', 'no_show']

const ETIQUETA_CANAL: Record<string, string> = {
  directo: 'Directo',
  web: 'Web (portal)',
  booking: 'Booking',
  expedia: 'Expedia',
}

interface ReservaRow {
  canal: string
  estado: EstadoReserva
  total: number | string
}

function Kpi({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="text-sm text-stone-500">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-stone-400">{detalle}</p>}
    </div>
  )
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  await requerirAcceso('reportes')
  const sp = await searchParams
  const mes = RE_MES.test(sp.mes ?? '') ? sp.mes! : mesActual()
  const { inicio, fin } = inicioFinDeMes(mes)
  const diasDelMes = diasEntre(inicio, fin)

  const supabase = await crearClienteServidor()
  const [
    { data: unidades },
    { data: estadias },
    { data: reservasData },
    { data: pagos },
    { data: facturas },
  ] = await Promise.all([
    supabase.from('unidades').select('id').eq('activo', true),
    supabase
      .from('estadias')
      .select('periodo, estado, precio_noche')
      .in('estado', ['pendiente', 'confirmada', 'pagada', 'in_house', 'checkout']),
    supabase.from('reservas').select('canal, estado, total'),
    supabase.from('pagos').select('tipo, monto').eq('estado', 'aprobado'),
    supabase.from('facturas').select('total'),
  ])

  // Ocupación del mes (noches ocupadas / capacidad).
  const capacidad = (unidades?.length ?? 0) * diasDelMes
  let ocupadas = 0
  let ingresoAlojamiento = 0
  for (const e of estadias ?? []) {
    const n = nochesEnVentana(parsearPeriodo(e.periodo as string), inicio, fin)
    ocupadas += n
    ingresoAlojamiento += n * Number((e as { precio_noche?: number | string }).precio_noche ?? 0)
  }
  const ocupacionPct = capacidad ? Math.round((ocupadas / capacidad) * 100) : 0
  // ADR (tarifa media diaria) = ingreso alojamiento / noches vendidas.
  // RevPAR (ingreso por habitación disponible) = ingreso alojamiento / capacidad.
  const adr = ocupadas ? Math.round(ingresoAlojamiento / ocupadas) : 0
  const revpar = capacidad ? Math.round(ingresoAlojamiento / capacidad) : 0

  // Ingresos (pagos aprobados) y facturación — históricos.
  let ingresos = 0
  for (const p of pagos ?? []) {
    ingresos += p.tipo === 'reembolso' ? -Number(p.monto) : Number(p.monto)
  }
  const facturado = (facturas ?? []).reduce((acc, f) => acc + Number(f.total), 0)

  // Ranking de canales y reservas por estado.
  const reservas = (reservasData ?? []) as ReservaRow[]
  const porCanal = new Map<string, { cantidad: number; monto: number }>()
  const porEstado = new Map<EstadoReserva, number>()
  for (const r of reservas) {
    const c = porCanal.get(r.canal) ?? { cantidad: 0, monto: 0 }
    c.cantidad += 1
    if (!ESTADOS_NO_VENDIDOS.includes(r.estado)) c.monto += Number(r.total)
    porCanal.set(r.canal, c)
    porEstado.set(r.estado, (porEstado.get(r.estado) ?? 0) + 1)
  }
  const canales = [...porCanal.entries()].sort((a, b) => b[1].cantidad - a[1].cantidad)
  const maxEstado = Math.max(1, ...[...porEstado.values()])

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Reportes</h1>
          <p className="text-sm text-stone-500">Indicadores de gestión.</p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Mes (ocupación)</span>
            <input
              type="month"
              name="mes"
              defaultValue={mes}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600"
            />
          </label>
          <button className="rounded-lg bg-stone-800 px-3 py-2 text-sm font-medium text-white hover:bg-stone-900">
            Ver
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Kpi
          titulo={`Ocupación ${mes}`}
          valor={`${ocupacionPct}%`}
          detalle={`${ocupadas} de ${capacidad} noches-unidad`}
        />
        <Kpi titulo="ADR (tarifa media)" valor={`USD ${adr.toLocaleString('es-AR')}`} detalle="por noche vendida (neto)" />
        <Kpi titulo="RevPAR" valor={`USD ${revpar.toLocaleString('es-AR')}`} detalle="por unidad disponible (neto)" />
        <Kpi titulo="Reservas (histórico)" valor={String(reservas.length)} />
        <Kpi
          titulo="Ingresos cobrados"
          valor={`USD ${ingresos.toLocaleString('es-AR')}`}
          detalle="pagos aprobados"
        />
        <Kpi
          titulo="Facturado"
          valor={`USD ${facturado.toLocaleString('es-AR')}`}
          detalle="comprobantes emitidos"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Ranking de canales</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="py-1.5">Canal</th>
                <th className="py-1.5 text-right">Reservas</th>
                <th className="py-1.5 text-right">Monto (USD)</th>
              </tr>
            </thead>
            <tbody>
              {canales.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-stone-400">
                    Sin datos.
                  </td>
                </tr>
              )}
              {canales.map(([canal, v]) => (
                <tr key={canal} className="border-t border-stone-100">
                  <td className="py-2 text-stone-700">{ETIQUETA_CANAL[canal] ?? canal}</td>
                  <td className="py-2 text-right text-stone-800">{v.cantidad}</td>
                  <td className="py-2 text-right text-stone-800">
                    {v.monto.toLocaleString('es-AR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Reservas por estado</h2>
          <div className="flex flex-col gap-2">
            {ESTADOS_RESERVA.map((e) => {
              const n = porEstado.get(e) ?? 0
              return (
                <div key={e} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-stone-500">{ETIQUETAS_ESTADO_RESERVA[e]}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-stone-100">
                    <div
                      className="h-full rounded bg-sky-500"
                      style={{ width: `${(n / maxEstado) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-medium text-stone-700">{n}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
