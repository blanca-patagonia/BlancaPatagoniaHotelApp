import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_ACTIVOS, ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { ETIQUETAS_ESTADO_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import {
  hoyISO,
  sumarDias,
  listaDias,
  parsearPeriodo,
  contieneDia,
  rangoISO,
  formatoFechaCorta,
} from '@/lib/fechas'

const DIAS_VENTANA = 14
const LETRA_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

interface TipoRef {
  codigo: string
  nombre: string
  categoria: 'hosteria' | 'cabana'
}
interface UnidadRow {
  id: string
  nombre: string
  estado: EstadoHousekeeping
  tipo: TipoRef | null
}
interface EstadiaRow {
  unidad_id: string
  periodo: string
  estado: EstadoReserva
  reserva: { codigo: string; huesped: { apellido: string; nombre: string } | null } | null
}

const COLOR_ESTADIA: Record<string, string> = {
  pendiente: 'bg-stone-300 text-stone-800',
  confirmada: 'bg-sky-500 text-white',
  pagada: 'bg-emerald-500 text-white',
  in_house: 'bg-amber-500 text-white',
}

const COLOR_HK: Record<EstadoHousekeeping, string> = {
  limpia: 'bg-emerald-500',
  sucia: 'bg-amber-500',
  inspeccionada: 'bg-sky-500',
  bloqueada: 'bg-red-500',
}

function esFinDeSemana(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay()
  return d === 0 || d === 6
}

export default async function OcupacionPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string }>
}) {
  await requerirAcceso('ocupacion')
  const sp = await searchParams
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? '') ? sp.desde! : hoyISO()
  const hasta = sumarDias(desde, DIAS_VENTANA)
  const dias = listaDias(desde, DIAS_VENTANA)

  const supabase = await crearClienteServidor()
  const [{ data: unidadesData }, { data: estadiasData }] = await Promise.all([
    supabase
      .from('unidades')
      .select('id, nombre, estado, tipo:tipos_unidad(codigo, nombre, categoria)')
      .eq('activo', true),
    supabase
      .from('estadias')
      .select('unidad_id, periodo, estado, reserva:reservas(codigo, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre))')
      .in('estado', [...ESTADOS_ACTIVOS])
      .overlaps('periodo', rangoISO(desde, hasta)),
  ])

  const unidades = (unidadesData ?? []) as unknown as UnidadRow[]
  const estadias = (estadiasData ?? []) as unknown as EstadiaRow[]

  unidades.sort((a, b) => {
    const ca = a.tipo?.categoria ?? ''
    const cb = b.tipo?.categoria ?? ''
    if (ca !== cb) return ca < cb ? -1 : 1
    const ta = a.tipo?.nombre ?? ''
    const tb = b.tipo?.nombre ?? ''
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.nombre.localeCompare(b.nombre)
  })

  // unidad_id -> (día -> estadía)
  const porUnidad = new Map<string, Map<string, EstadiaRow>>()
  for (const e of estadias) {
    const p = parsearPeriodo(e.periodo)
    const mapa = porUnidad.get(e.unidad_id) ?? new Map<string, EstadiaRow>()
    for (const dia of dias) if (contieneDia(p, dia)) mapa.set(dia, e)
    porUnidad.set(e.unidad_id, mapa)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Ocupación</h1>
          <p className="text-sm text-stone-500">
            {formatoFechaCorta(desde)} — {formatoFechaCorta(sumarDias(hasta, -1))} · {unidades.length} unidades
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/panel/ocupacion?desde=${sumarDias(desde, -DIAS_VENTANA)}`}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-100"
          >
            ‹ Anterior
          </Link>
          <Link
            href="/panel/ocupacion"
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-100"
          >
            Hoy
          </Link>
          <Link
            href={`/panel/ocupacion?desde=${sumarDias(desde, DIAS_VENTANA)}`}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-100"
          >
            Siguiente ›
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200">
              <th className="sticky left-0 z-10 bg-stone-50 px-3 py-2 text-left font-medium text-stone-600">
                Unidad
              </th>
              {dias.map((dia) => (
                <th
                  key={dia}
                  className={`min-w-10 px-1 py-2 text-center text-xs font-medium ${
                    esFinDeSemana(dia) ? 'bg-stone-100 text-stone-500' : 'text-stone-500'
                  }`}
                >
                  <div>{LETRA_DIA[new Date(dia + 'T00:00:00Z').getUTCDay()]}</div>
                  <div className="text-stone-400">{formatoFechaCorta(dia)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {unidades.map((u) => {
              const mapa = porUnidad.get(u.id)
              return (
                <tr key={u.id} className="border-b border-stone-100 last:border-0">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${COLOR_HK[u.estado]}`}
                        title={ETIQUETAS_ESTADO_HK[u.estado]}
                      />
                      <span className="font-medium text-stone-800">{u.nombre}</span>
                      <span className="text-xs text-stone-400">{u.tipo?.nombre}</span>
                    </div>
                  </td>
                  {dias.map((dia) => {
                    const e = mapa?.get(dia)
                    if (!e) {
                      return (
                        <td
                          key={dia}
                          className={`px-0.5 py-1.5 ${esFinDeSemana(dia) ? 'bg-stone-50' : ''}`}
                        />
                      )
                    }
                    const apellido = e.reserva?.huesped?.apellido ?? ''
                    return (
                      <td key={dia} className="px-0.5 py-1.5">
                        <div
                          className={`truncate rounded px-1 py-1 text-center text-[10px] leading-tight ${
                            COLOR_ESTADIA[e.estado] ?? 'bg-stone-300 text-stone-800'
                          }`}
                          title={`${e.reserva?.codigo ?? ''} · ${apellido} · ${ETIQUETAS_ESTADO_RESERVA[e.estado]}`}
                        >
                          {apellido || e.reserva?.codigo?.slice(-4) || '•'}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Leyenda */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-stone-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-sky-500" /> Confirmada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-emerald-500" /> Pagada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-amber-500" /> In house
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-stone-300" /> Pendiente
        </span>
      </div>
    </div>
  )
}
