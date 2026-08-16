import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ESTADOS_ACTIVOS,
  ETIQUETAS_ESTADO_RESERVA,
  type EstadoReserva,
} from '@/lib/domain/reservas'
import {
  ESTADOS_HK,
  ETIQUETAS_ESTADO_HK,
  type EstadoHousekeeping,
} from '@/lib/domain/unidades'
import {
  claveEstado,
  resumenPorDia,
  tonoOcupacion,
  totalesDeVentana,
  type EstadiaGrilla,
  type ResumenDia,
} from '@/lib/domain/grilla'
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
import { Icono } from '../_components/iconos'
import {
  BarraHerramientas,
  Chip,
  Encabezado,
  EstadoUnidad,
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
  /** Piso y bloque (migración 0042). Vacío = no cargado. */
  piso: string
  bloque: string
  orden: number
  tipo: TipoRef | null
}
interface EstadiaRow {
  unidad_id: string
  periodo: string
  estado: EstadoReserva
  /** Hace falta para el pax de la fila resumen. */
  huespedes: number
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

/**
 * Filas del resumen, en el orden en que se muestran.
 *
 * Se declara como tabla y no como seis bloques de JSX repetidos: son la misma
 * celda con distinto número, y así agregar una fila —pax de menores, por
 * ejemplo— es sumar una entrada acá.
 *
 * El orden no es casual: arriba lo que se vende (ocupadas / libres), en el medio
 * el movimiento del día (llegadas / salidas) y abajo los dos totales de contexto.
 */
const FILAS_RESUMEN: readonly {
  clave: string
  titulo: string
  valor: (r: ResumenDia) => number
}[] = [
  { clave: 'ocupadas', titulo: 'Ocupadas', valor: (r) => r.ocupadas },
  { clave: 'libres', titulo: 'Libres', valor: (r) => r.libres },
  { clave: 'llegadas', titulo: 'Llegadas', valor: (r) => r.llegadas },
  { clave: 'salidas', titulo: 'Salidas', valor: (r) => r.salidas },
  { clave: 'pax', titulo: 'Pax', valor: (r) => r.pax },
  { clave: 'ocupacion', titulo: '% ocupación', valor: (r) => r.ocupacionPct },
]

function esFinDeSemana(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay()
  return d === 0 || d === 6
}

export default async function OcupacionPage({
  searchParams,
}: {
  searchParams: Promise<{
    desde?: string
    dias?: string
    cat?: string
    bloque?: string
    piso?: string
    hk?: string
  }>
}) {
  await requerirAcceso('ocupacion')
  const sp = await searchParams

  const hoy = hoyISO()
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? '') ? sp.desde! : hoy
  const ventana = VENTANAS.includes(Number(sp.dias) as (typeof VENTANAS)[number])
    ? Number(sp.dias)
    : VENTANA_DEFECTO
  const categoria = sp.cat === 'hosteria' || sp.cat === 'cabana' ? sp.cat : undefined
  const bloque = sp.bloque?.trim() || undefined
  const piso = sp.piso?.trim() || undefined
  const estadoHk = ESTADOS_HK.includes(sp.hk as EstadoHousekeeping)
    ? (sp.hk as EstadoHousekeeping)
    : undefined

  const hasta = sumarDias(desde, ventana)
  const dias = listaDias(desde, ventana)

  const supabase = await crearClienteServidor()
  const [{ data: unidadesData }, { data: estadiasData }] = await Promise.all([
    supabase
      .from('unidades')
      .select('id, nombre, estado, piso, bloque, orden, tipo:tipos_unidad(codigo, nombre, categoria)')
      .eq('activo', true),
    supabase
      .from('estadias')
      .select(
        'unidad_id, periodo, estado, huespedes, reserva:reservas(id, codigo, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre))',
      )
      .in('estado', [...ESTADOS_ACTIVOS])
      .overlaps('periodo', rangoISO(desde, hasta)),
  ])

  const todasUnidades = (unidadesData ?? []) as unknown as UnidadRow[]
  const estadias = (estadiasData ?? []) as unknown as EstadiaRow[]

  // ── Filtros ────────────────────────────────────────────────────────────────
  // Bloque y piso llegan de la migración 0042. Los valores disponibles se derivan
  // de los datos y no de una lista fija: el hotel puede nombrar sus sectores como
  // quiera, y una lista codificada mostraría opciones que no existen.
  const bloques = [...new Set(todasUnidades.map((u) => u.bloque).filter(Boolean))].sort()
  const pisos = [...new Set(todasUnidades.map((u) => u.piso).filter(Boolean))].sort()

  let unidades = categoria
    ? todasUnidades.filter((u) => u.tipo?.categoria === categoria)
    : todasUnidades
  if (bloque) unidades = unidades.filter((u) => u.bloque === bloque)
  if (piso) unidades = unidades.filter((u) => u.piso === piso)
  if (estadoHk) unidades = unidades.filter((u) => u.estado === estadoHk)

  // Se ordena por el recorrido físico: bloque, piso, orden dentro del piso. Es el
  // camino que hace la mucama, y `orden` existe justamente porque el alfabético
  // pone «10» antes que «9».
  unidades = [...unidades].sort((a, b) => {
    if (a.bloque !== b.bloque) return a.bloque.localeCompare(b.bloque)
    if (a.piso !== b.piso) return a.piso.localeCompare(b.piso, 'es', { numeric: true })
    if (a.orden !== b.orden) return a.orden - b.orden
    const ta = a.tipo?.nombre ?? ''
    const tb = b.tipo?.nombre ?? ''
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.nombre.localeCompare(b.nombre, 'es', { numeric: true })
  })

  // unidad_id -> (día -> estadía)
  const porUnidad = new Map<string, Map<string, EstadiaRow>>()
  for (const e of estadias) {
    const p = parsearPeriodo(e.periodo)
    const mapa = porUnidad.get(e.unidad_id) ?? new Map<string, EstadiaRow>()
    for (const dia of dias) if (contieneDia(p, dia)) mapa.set(dia, e)
    porUnidad.set(e.unidad_id, mapa)
  }

  // ── Resumen por día ────────────────────────────────────────────────────────
  // La fila de abajo de la grilla y los indicadores de arriba salen de la MISMA
  // cuenta (`resumenPorDia` → `totalesDeVentana`). Antes los indicadores se
  // calculaban acá a mano; con dos cuentas separadas era cuestión de tiempo que
  // mostraran números que no cerraran entre sí.
  //
  // Solo entran las estadías de las unidades visibles: si está filtrado por
  // cabañas, la ocupación tiene que ser la de las cabañas.
  const idsVisibles = new Set(unidades.map((u) => u.id))
  const paraResumen: EstadiaGrilla[] = estadias
    .filter((e) => idsVisibles.has(e.unidad_id))
    .map((e) => ({
      unidadId: e.unidad_id,
      periodo: parsearPeriodo(e.periodo),
      estado: e.estado,
      huespedes: e.huespedes ?? 1,
    }))

  const resumen = resumenPorDia(dias, unidades.length, paraResumen)
  const totales = totalesDeVentana(resumen)

  // Día de referencia del indicador de «libres»: hoy si está a la vista, y si no
  // el primero de la ventana. Sin esto, al navegar al mes que viene el indicador
  // decía «libres hoy» calculado sobre un día que no está en pantalla.
  const diaReferencia = resumen.find((r) => r.dia === hoy) ?? resumen[0]
  const esHoyReferencia = diaReferencia?.dia === hoy

  const vigentes = {
    desde: sp.desde,
    dias: sp.dias,
    cat: sp.cat,
    bloque,
    piso,
    hk: estadoHk,
  }

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
          valor={`${totales.ocupacionPct}%`}
          detalle={`${totales.nochesOcupadas} de ${totales.nochesDisponibles} noches`}
          icono="ocupacion"
        />
        <Kpi
          titulo={esHoyReferencia ? 'Libres hoy' : `Libres el ${formatoFechaCorta(diaReferencia?.dia ?? desde)}`}
          valor={String(diaReferencia?.libres ?? unidades.length)}
          detalle="unidades sin ocupar"
          icono="ok"
          tono="exito"
        />
        <Kpi
          titulo="Movimiento del período"
          valor={`${totales.llegadas} / ${totales.salidas}`}
          detalle="llegadas / salidas"
          icono="reservas"
        />
        <Kpi
          titulo="Día más cargado"
          valor={totales.diaMasCargado ? `${totales.diaMasCargado.ocupacionPct}%` : '—'}
          detalle={
            totales.diaMasCargado ? formatoFechaCorta(totales.diaMasCargado.dia) : 'sin datos'
          }
          icono="alerta"
          tono={totales.diaMasCargado && totales.diaMasCargado.ocupacionPct >= 100 ? 'peligro' : 'alerta'}
        />
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

        {/* ── Filtros por ubicación y estado de limpieza (paso 10) ────────────
            Los valores salen de los datos, no de una lista fija: el hotel nombra
            sus sectores como quiera, y una lista codificada ofrecería opciones
            inexistentes. Si no hay ningún bloque o piso cargado, el filtro no
            aparece — un desplegable vacío es peor que ninguno. */}
        {bloques.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <Chip href={`/panel/ocupacion${construirQuery(vigentes, { bloque: undefined })}`} activo={!bloque}>
              Todo el predio
            </Chip>
            {bloques.map((b) => (
              <Chip
                key={b}
                href={`/panel/ocupacion${construirQuery(vigentes, { bloque: b })}`}
                activo={bloque === b}
              >
                {b}
              </Chip>
            ))}
          </div>
        )}

        {pisos.length > 0 && (
          <form method="get" action="/panel/ocupacion" className="flex items-center gap-2">
            {sp.desde && <input type="hidden" name="desde" value={sp.desde} />}
            {sp.dias && <input type="hidden" name="dias" value={sp.dias} />}
            {categoria && <input type="hidden" name="cat" value={categoria} />}
            {bloque && <input type="hidden" name="bloque" value={bloque} />}
            <label className="flex items-center gap-1.5 text-xs text-stone-500">
              Piso
              <select
                name="piso"
                defaultValue={piso ?? ''}
                aria-label="Filtrar por piso"
                className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
              >
                <option value="">Todos</option>
                {pisos.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <select
              name="hk"
              defaultValue={estadoHk ?? ''}
              aria-label="Filtrar por estado de limpieza"
              className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
            >
              <option value="">Toda limpieza</option>
              {ESTADOS_HK.map((e) => (
                <option key={e} value={e}>
                  {ETIQUETAS_ESTADO_HK[e]}
                </option>
              ))}
            </select>
            <button className={botonClases('secundario')}>Filtrar</button>
          </form>
        )}

        {(bloque || piso || estadoHk) && (
          <Link
            href={`/panel/ocupacion${construirQuery({ desde: sp.desde, dias: sp.dias, cat: sp.cat })}`}
            className={botonClases('fantasma')}
          >
            Limpiar filtros
          </Link>
        )}
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
                      <div className={esHoy ? 'font-semibold' : 'text-stone-600'}>
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
                        <EstadoUnidad estado={u.estado} />
                        <span className="font-medium text-stone-800">{u.nombre}</span>
                        <span className="text-xs text-stone-600">
                          {u.tipo?.nombre}
                          {/* Ubicación al lado del nombre: es lo que permite
                              reconocer dónde queda sin abrir otra pantalla. */}
                          {u.piso && <span className="ml-1.5">· piso {u.piso}</span>}
                        </span>

                        {/* ── Acciones rápidas (paso 10) ─────────────────────
                            WinPAX las tenía en la grilla y acá había que salir a
                            otra pantalla para cada una. Son enlaces y no botones
                            de acción directa a propósito: un clic accidental en
                            una grilla densa no puede cambiar el estado de una
                            habitación sin confirmación. Llevan a la pantalla que
                            corresponde, ya filtrada por esta unidad. */}
                        <span className="ml-1 flex items-center gap-1.5 text-xs">
                          <Link
                            href={`/panel/housekeeping?estado=${u.estado === 'sucia' ? 'sucia' : 'limpia'}`}
                            title={`Limpieza de ${u.nombre} — está ${ETIQUETAS_ESTADO_HK[u.estado].toLowerCase()}`}
                            className="text-stone-400 transition hover:text-lago-700"
                          >
                            <Icono nombre="housekeeping" tam={14} />
                            <span className="sr-only">
                              Limpieza de {u.nombre}: {ETIQUETAS_ESTADO_HK[u.estado]}
                            </span>
                          </Link>
                          <Link
                            href={`/panel/mantenimiento/nueva?unidad=${u.id}`}
                            title={`Reportar un desperfecto en ${u.nombre}`}
                            className="text-stone-400 transition hover:text-lenga-700"
                          >
                            <Icono nombre="mantenimiento" tam={14} />
                            <span className="sr-only">Reportar desperfecto en {u.nombre}</span>
                          </Link>
                        </span>
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
                      const nombreEstado = ETIQUETAS_ESTADO_RESERVA[e.estado]
                      const etiqueta = `${e.reserva?.codigo ?? ''} · ${apellido} · ${nombreEstado}`

                      // El estado se comunica con LETRA + color, nunca sólo con
                      // color: cuatro bloques de colores distintos son cuatro
                      // bloques iguales para quien no los distingue, y acá el
                      // color era lo único que separaba «está paga» de «puede
                      // caerse». La celda mide ~40 px, así que no entra texto:
                      // entra una letra, y el nombre completo va en el title y
                      // en el texto para lector de pantalla.
                      const bloque = (
                        <div
                          className={`flex items-center gap-0.5 rounded px-1 py-1 text-[10px] leading-tight ${
                            COLOR_ESTADIA[e.estado] ?? 'bg-stone-300 text-stone-800'
                          }`}
                        >
                          <span aria-hidden className="font-bold opacity-90">
                            {claveEstado(e.estado)}
                          </span>
                          <span className="truncate">
                            {apellido || e.reserva?.codigo?.slice(-4) || ''}
                          </span>
                          <span className="sr-only">
                            {`${u.nombre}, ${formatoFechaCorta(dia)}: ${nombreEstado}${apellido ? `, ${apellido}` : ''}`}
                          </span>
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

            {/* ── Fila resumen por día ────────────────────────────────────────
                Es lo que tenía WinPAX debajo de las habitaciones y lo que
                recepción mira para saber si la noche está vendida. Los
                indicadores de arriba son del período completo: un 60 % en la
                quincena no dice nada sobre si hoy quedan camas.

                Va en `tfoot` y no en `tbody` porque semánticamente es el
                resumen de la tabla, y así un lector de pantalla lo anuncia como
                tal. Queda pegada abajo al hacer scroll vertical. */}
            <tfoot className="sticky bottom-0 border-t-2 border-stone-300 bg-stone-50 text-xs">
              {FILAS_RESUMEN.map((fila) => (
                <tr key={fila.clave} className="border-t border-stone-200 first:border-t-0">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-stone-50 px-3 py-1 text-left font-medium whitespace-nowrap text-stone-600"
                  >
                    {fila.titulo}
                  </th>
                  {resumen.map((r) => {
                    const valor = fila.valor(r)
                    const tono = fila.clave === 'ocupacion' ? tonoOcupacion(r.ocupacionPct) : null

                    return (
                      <td
                        key={r.dia}
                        className={`px-1 py-1 text-center tabular ${
                          tono === 'completo'
                            ? 'bg-red-100 font-semibold text-red-900'
                            : tono === 'alto'
                              ? 'bg-lenga-100 font-medium text-lenga-900'
                              : r.dia === hoy
                                ? 'bg-lago-50 text-stone-700'
                                : 'text-stone-600'
                        }`}
                      >
                        {/* El valor exacto está escrito: el color sólo responde
                            «¿hay que preocuparse?». Y el 100 % lleva además un
                            texto para lector de pantalla, porque «15» y «15»
                            se leen igual estando completo o no. */}
                        {valor === 0 && fila.clave !== 'ocupacion' ? (
                          <span className="text-stone-300">·</span>
                        ) : (
                          <>
                            {fila.clave === 'ocupacion' ? `${valor}%` : valor}
                            {tono === 'completo' && <span className="sr-only"> — completo</span>}
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </Tarjeta>

      {/* Referencia: cada estado con su LETRA además del color, para que la
          grilla se pueda leer sin distinguir colores. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-500">
        <span className="font-medium text-stone-600">Referencia:</span>
        {(['pendiente', 'confirmada', 'pagada', 'in_house'] as const).map((e) => (
          <span key={e} className="flex items-center gap-1.5">
            <span
              className={`inline-flex size-4 items-center justify-center rounded text-[9px] font-bold ${
                COLOR_ESTADIA[e] ?? 'bg-stone-300 text-stone-800'
              }`}
              aria-hidden
            >
              {claveEstado(e)}
            </span>
            {ETIQUETAS_ESTADO_RESERVA[e]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-4 rounded bg-lenga-100 ring-1 ring-lenga-200" aria-hidden />
          85 % o más
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-4 rounded bg-red-100 ring-1 ring-red-200" aria-hidden />
          Completo
        </span>
        <span className="text-stone-600">· Clic en una celda libre para crear la reserva</span>
      </div>
    </Pagina>
  )
}
