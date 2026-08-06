import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ESTADOS_ACTIVOS,
  ETIQUETAS_ESTADO_RESERVA,
  type EstadoReserva,
} from '@/lib/domain/reservas'
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
import { construirQuery } from '@/lib/listados'
import { PUNTO_HK } from '../_components/estilos'
import { Icono } from '../_components/iconos'
import {
  BarraHerramientas,
  Chip,
  Encabezado,
  Kpi,
  Pagina,
  Tarjeta,
  botonClases,
} from '../_components/ui'

const LETRA_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
/** Ventanas de días que se pueden mostrar en la grilla. */
const VENTANAS = [14, 30] as const
const VENTANA_DEFECTO = 14

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
  reserva: {
    id: string
    codigo: string
    huesped: { apellido: string; nombre: string } | null
  } | null
}

/** Color del bloque de estadía dentro de la grilla. */
const COLOR_ESTADIA: Record<string, string> = {
  pendiente: 'bg-stone-300 text-stone-800',
  confirmada: 'bg-lago-500 text-white',
  pagada: 'bg-emerald-500 text-white',
  in_house: 'bg-lenga-500 text-white',
}

function esFinDeSemana(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay()
  return d === 0 || d === 6
}

export default async function OcupacionPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; dias?: string; cat?: string }>
}) {
  await requerirAcceso('ocupacion')
  const sp = await searchParams

  const hoy = hoyISO()
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? '') ? sp.desde! : hoy
  const ventana = VENTANAS.includes(Number(sp.dias) as (typeof VENTANAS)[number])
    ? Number(sp.dias)
    : VENTANA_DEFECTO
  const categoria = sp.cat === 'hosteria' || sp.cat === 'cabana' ? sp.cat : undefined

  const hasta = sumarDias(desde, ventana)
  const dias = listaDias(desde, ventana)

  const supabase = await crearClienteServidor()
  const [{ data: unidadesData }, { data: estadiasData }] = await Promise.all([
    supabase
      .from('unidades')
      .select('id, nombre, estado, tipo:tipos_unidad(codigo, nombre, categoria)')
      .eq('activo', true),
    supabase
      .from('estadias')
      .select(
        'unidad_id, periodo, estado, reserva:reservas(id, codigo, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre))',
      )
      .in('estado', [...ESTADOS_ACTIVOS])
      .overlaps('periodo', rangoISO(desde, hasta)),
  ])

  const todasUnidades = (unidadesData ?? []) as unknown as UnidadRow[]
  const estadias = (estadiasData ?? []) as unknown as EstadiaRow[]

  const unidades = categoria
    ? todasUnidades.filter((u) => u.tipo?.categoria === categoria)
    : todasUnidades

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

  // Indicadores de la ventana visible.
  let nochesOcupadas = 0
  for (const u of unidades) nochesOcupadas += porUnidad.get(u.id)?.size ?? 0
  const nochesDisponibles = unidades.length * dias.length
  const ocupacionVentana = nochesDisponibles
    ? Math.round((nochesOcupadas / nochesDisponibles) * 100)
    : 0
  const libresHoy = unidades.filter((u) => !porUnidad.get(u.id)?.get(hoy)).length

  const vigentes = { desde: sp.desde, dias: sp.dias, cat: sp.cat }

  return (
    <Pagina ancho="ancho">
      <Encabezado
        titulo="Ocupación"
        descripcion={`${formatoFechaCorta(desde)} — ${formatoFechaCorta(sumarDias(hasta, -1))} · ${unidades.length} unidades`}
        icono="ocupacion"
        acciones={
          <>
            <Link
              href={`/panel/ocupacion${construirQuery(vigentes, { desde: sumarDias(desde, -ventana) })}`}
              className={botonClases('secundario', 'px-2')}
              aria-label="Período anterior"
            >
              <Icono nombre="anterior" tam={16} />
            </Link>
            <Link
              href={`/panel/ocupacion${construirQuery(vigentes, { desde: undefined })}`}
              className={botonClases('secundario')}
            >
              Hoy
            </Link>
            <Link
              href={`/panel/ocupacion${construirQuery(vigentes, { desde: sumarDias(desde, ventana) })}`}
              className={botonClases('secundario', 'px-2')}
              aria-label="Período siguiente"
            >
              <Icono nombre="siguiente" tam={16} />
            </Link>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Ocupación del período"
          valor={`${ocupacionVentana}%`}
          detalle={`${nochesOcupadas} de ${nochesDisponibles} noches`}
          icono="ocupacion"
        />
        <Kpi titulo="Libres hoy" valor={String(libresHoy)} detalle="unidades sin ocupar" icono="ok" tono="exito" />
        <Kpi
          titulo="Estadías en pantalla"
          valor={String(estadias.length)}
          detalle="reservas que tocan el período"
          icono="reservas"
        />
        <Kpi titulo="Unidades" valor={String(unidades.length)} detalle="activas" icono="housekeeping" />
      </div>

      <BarraHerramientas>
        <form method="get" action="/panel/ocupacion" className="flex items-center gap-2">
          {sp.dias && <input type="hidden" name="dias" value={sp.dias} />}
          {categoria && <input type="hidden" name="cat" value={categoria} />}
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            Ir a la fecha
            <input
              type="date"
              name="desde"
              defaultValue={desde}
              aria-label="Ir a la fecha"
              className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
            />
          </label>
          <button className={botonClases('secundario')}>Ver</button>
        </form>

        <div className="flex gap-1.5">
          <Chip href={`/panel/ocupacion${construirQuery(vigentes, { cat: undefined })}`} activo={!categoria}>
            Todo
          </Chip>
          <Chip
            href={`/panel/ocupacion${construirQuery(vigentes, { cat: 'hosteria' })}`}
            activo={categoria === 'hosteria'}
          >
            Hostería
          </Chip>
          <Chip
            href={`/panel/ocupacion${construirQuery(vigentes, { cat: 'cabana' })}`}
            activo={categoria === 'cabana'}
          >
            Cabañas
          </Chip>
        </div>

        <div className="flex gap-1.5">
          {VENTANAS.map((v) => (
            <Chip
              key={v}
              href={`/panel/ocupacion${construirQuery(vigentes, { dias: v === VENTANA_DEFECTO ? undefined : v })}`}
              activo={ventana === v}
            >
              {v} días
            </Chip>
          ))}
        </div>
      </BarraHerramientas>

      <Tarjeta className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <caption className="sr-only">
              Grilla de ocupación por unidad y día. Las celdas libres abren una reserva nueva.
            </caption>
            <thead>
              <tr className="border-b border-stone-200">
                <th className="sticky left-0 z-10 bg-stone-50 px-3 py-2 text-left font-medium text-stone-600">
                  Unidad
                </th>
                {dias.map((dia) => {
                  const esHoy = dia === hoy
                  return (
                    <th
                      key={dia}
                      aria-current={esHoy ? 'date' : undefined}
                      className={`min-w-10 px-1 py-2 text-center text-xs font-medium ${
                        esHoy
                          ? 'bg-lago-100 text-lago-900'
                          : esFinDeSemana(dia)
                            ? 'bg-stone-100 text-stone-500'
                            : 'text-stone-500'
                      }`}
                    >
                      <div>{LETRA_DIA[new Date(dia + 'T00:00:00Z').getUTCDay()]}</div>
                      <div className={esHoy ? 'font-semibold' : 'text-stone-400'}>
                        {formatoFechaCorta(dia)}
                      </div>
                    </th>
                  )
                })}
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
                          className={`inline-block size-2 rounded-full ${PUNTO_HK[u.estado]}`}
                          title={ETIQUETAS_ESTADO_HK[u.estado]}
                        />
                        <span className="font-medium text-stone-800">{u.nombre}</span>
                        <span className="text-xs text-stone-400">{u.tipo?.nombre}</span>
                      </div>
                    </td>
                    {dias.map((dia) => {
                      const e = mapa?.get(dia)
                      const esHoy = dia === hoy

                      // Celda libre: atajo para crear una reserva de esa noche.
                      if (!e) {
                        return (
                          <td
                            key={dia}
                            className={`px-0.5 py-1.5 ${
                              esHoy ? 'bg-lago-50' : esFinDeSemana(dia) ? 'bg-stone-50' : ''
                            }`}
                          >
                            <Link
                              href={`/panel/reservas/nueva?check_in=${dia}&check_out=${sumarDias(dia, 1)}`}
                              title={`${u.nombre} libre el ${formatoFechaCorta(dia)} — crear reserva`}
                              className="flex h-6 items-center justify-center rounded text-stone-300 transition hover:bg-lago-100 hover:text-lago-700"
                            >
                              <span className="text-xs opacity-0 transition hover:opacity-100">+</span>
                            </Link>
                          </td>
                        )
                      }

                      const apellido = e.reserva?.huesped?.apellido ?? ''
                      const etiqueta = `${e.reserva?.codigo ?? ''} · ${apellido} · ${ETIQUETAS_ESTADO_RESERVA[e.estado]}`
                      const bloque = (
                        <div
                          className={`truncate rounded px-1 py-1 text-center text-[10px] leading-tight ${
                            COLOR_ESTADIA[e.estado] ?? 'bg-stone-300 text-stone-800'
                          }`}
                        >
                          {apellido || e.reserva?.codigo?.slice(-4) || '•'}
                        </div>
                      )
                      return (
                        <td key={dia} className="px-0.5 py-1.5" title={etiqueta}>
                          {e.reserva ? (
                            <Link
                              href={`/panel/reservas/${e.reserva.id}`}
                              className="block transition hover:opacity-80"
                            >
                              {bloque}
                            </Link>
                          ) : (
                            bloque
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-stone-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded bg-stone-300" /> Pendiente
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded bg-lago-500" /> Confirmada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded bg-emerald-500" /> Pagada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded bg-lenga-500" /> In house
        </span>
        <span className="text-stone-400">· Clic en una celda libre para crear la reserva</span>
      </div>
    </Pagina>
  )
}
