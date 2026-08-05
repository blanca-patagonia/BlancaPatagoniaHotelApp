import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ETIQUETAS_ESTADO_RESERVA,
  ESTADOS_RESERVA,
  CANALES,
  ETIQUETAS_CANAL,
  type EstadoReserva,
  type Canal,
} from '@/lib/domain/reservas'
import { parsearPeriodo, formatoFechaCorta, diasEntre } from '@/lib/fechas'
import { construirQuery, paginaActual, rangoDePagina, TAMANIO_PAGINA } from '@/lib/listados'
import { TONO_ESTADO } from '../_components/estilos'
import {
  BarraHerramientas,
  BotonExportar,
  Buscador,
  COL_SECUNDARIA,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Mensaje,
  Paginacion,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../_components/ui'
import { consultaReservas, filtroTermino } from './consulta'
import { enviarRecordatoriosLlegada } from './actions'

interface Row {
  id: string
  codigo: string
  estado: EstadoReserva
  total: number | string
  canal: string
  creada_en: string
  huesped: { apellido: string; nombre: string; email: string | null } | null
  estadias: { periodo: string }[]
}

interface Params {
  q?: string
  estado?: string
  canal?: string
  desde?: string
  hasta?: string
  grupo?: string
  pagina?: string
  recordatorios?: string
}

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  await requerirAcceso('reservas')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado =
    sp.estado && (ESTADOS_RESERVA as readonly string[]).includes(sp.estado) ? sp.estado : undefined
  const canal = sp.canal && (CANALES as readonly string[]).includes(sp.canal) ? sp.canal : undefined
  const filtros = {
    q: sp.q,
    estado,
    canal,
    desde: sp.desde,
    hasta: sp.hasta,
    grupo: sp.grupo,
  }

  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)
  const orTermino = await filtroTermino(supabase, sp.q)
  const { data, count } = await consultaReservas(supabase, filtros, orTermino).range(desde, hasta)

  const reservas = (data ?? []) as unknown as Row[]
  const total = count ?? 0

  // Filtros vigentes, para que los enlaces (chips, páginas, export) los conserven.
  const vigentes: Record<string, string | undefined> = {
    q: sp.q,
    estado,
    canal,
    desde: sp.desde,
    hasta: sp.hasta,
    grupo: sp.grupo,
  }
  const hayFiltros = Object.values(vigentes).some(Boolean)
  const totalGrupo = sp.grupo ? reservas.reduce((acc, r) => acc + Number(r.total), 0) : 0

  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado
        titulo="Reservas"
        descripcion="Altas, seguimiento y ciclo de vida de cada reserva."
        icono="reservas"
        acciones={
          <>
            <form action={enviarRecordatoriosLlegada}>
              <button className={botonClases('secundario')}>Recordar llegadas de mañana</button>
            </form>
            <BotonExportar href={`/panel/exportar/reservas${construirQuery(vigentes)}`} />
            <Link href="/panel/reservas/nueva-grupo" className={botonClases('secundario')}>
              + Grupo
            </Link>
            <Link href="/panel/reservas/nueva" className={botonClases('primario')}>
              + Nueva reserva
            </Link>
          </>
        }
      />

      {sp.recordatorios && (
        <Mensaje tono="ok">
          Se enviaron {sp.recordatorios} recordatorio(s) a los huéspedes que llegan mañana.
        </Mensaje>
      )}

      {sp.grupo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-calafate-50 px-4 py-3 text-sm ring-1 ring-calafate-200">
          <span className="text-calafate-900">
            Reserva grupal · {reservas.length} unidad(es)
          </span>
          <span className="tabular font-semibold text-calafate-900">
            Total consolidado USD {totalGrupo.toLocaleString('es-AR')}
          </span>
        </div>
      )}

      <BarraHerramientas>
        <Buscador
          accion="/panel/reservas"
          valor={sp.q}
          etiqueta="Buscar reservas"
          placeholder="Código, huésped o email…"
          ocultos={{ estado, canal, desde: sp.desde, hasta: sp.hasta, grupo: sp.grupo }}
        />

        {/* Rango de fechas y canal: un solo formulario GET, sin JavaScript. */}
        <form method="get" action="/panel/reservas" className="flex flex-wrap items-center gap-2">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          {estado && <input type="hidden" name="estado" value={estado} />}
          <label className="flex items-center gap-1.5 text-sm text-stone-600">
            <span className="text-xs text-stone-500">Estadías entre</span>
            <input
              type="date"
              name="desde"
              defaultValue={sp.desde ?? ''}
              aria-label="Fecha desde"
              className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
            />
            <span className="text-stone-400">y</span>
            <input
              type="date"
              name="hasta"
              defaultValue={sp.hasta ?? ''}
              aria-label="Fecha hasta"
              className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
            />
          </label>
          <select
            name="canal"
            defaultValue={canal ?? ''}
            aria-label="Canal de venta"
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
          >
            <option value="">Todos los canales</option>
            {CANALES.map((c) => (
              <option key={c} value={c}>
                {ETIQUETAS_CANAL[c as Canal]}
              </option>
            ))}
          </select>
          <button type="submit" className={botonClases('secundario')}>
            Aplicar
          </button>
        </form>

        {hayFiltros && (
          <Link href="/panel/reservas" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip href={`/panel/reservas${construirQuery(vigentes, { estado: undefined, pagina: undefined })}`} activo={!estado}>
          Todas
        </Chip>
        {ESTADOS_RESERVA.map((e) => (
          <Chip
            key={e}
            href={`/panel/reservas${construirQuery(vigentes, { estado: e, pagina: undefined })}`}
            activo={estado === e}
          >
            {ETIQUETAS_ESTADO_RESERVA[e]}
          </Chip>
        ))}
      </div>

      <Tarjeta className="overflow-hidden">
        {reservas.length === 0 ? (
          <EstadoVacio
            titulo={hayFiltros ? 'Ninguna reserva coincide con la búsqueda' : 'Todavía no hay reservas'}
            descripcion={
              hayFiltros
                ? 'Probá con otro término o quitá los filtros aplicados.'
                : 'Cuando cargues la primera reserva vas a verla en esta lista.'
            }
            icono={hayFiltros ? 'buscar' : 'reservas'}
            accion={
              hayFiltros ? (
                <Link href="/panel/reservas" className={botonClases('secundario')}>
                  Limpiar filtros
                </Link>
              ) : (
                <Link href="/panel/reservas/nueva" className={botonClases('primario')}>
                  + Nueva reserva
                </Link>
              )
            }
          />
        ) : (
          <>
            <Tabla resumen="Listado de reservas con huésped, estadía, canal, total y estado">
              <thead>
                <tr>
                  <th className={TH}>Código</th>
                  <th className={TH}>Huésped</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Estadía</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Canal</th>
                  <th className={`${TH} ${COL_SECUNDARIA} text-right`}>Total</th>
                  <th className={TH}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {reservas.map((r) => {
                  const periodo = r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo) : null
                  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
                  return (
                    <tr key={r.id} className={FILA}>
                      <td className={TD}>
                        <Link
                          href={`/panel/reservas/${r.id}`}
                          className="font-medium text-lago-700 hover:underline"
                        >
                          {r.codigo}
                        </Link>
                      </td>
                      <td className={`${TD} text-stone-700`}>
                        {r.huesped ? `${r.huesped.apellido}, ${r.huesped.nombre}` : '—'}
                        {/* En el teléfono las columnas de fechas y total se
                            ocultan, pero las fechas son justo lo que recepción
                            necesita ver de un vistazo: se pliegan acá abajo. */}
                        {periodo && (
                          <span className="tabular block text-xs text-stone-500 sm:hidden">
                            {formatoFechaCorta(periodo.desde)} → {formatoFechaCorta(periodo.hasta)}
                            {' · USD '}
                            {Number(r.total).toLocaleString('es-AR')}
                          </span>
                        )}
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                        {periodo ? (
                          <>
                            {formatoFechaCorta(periodo.desde)} → {formatoFechaCorta(periodo.hasta)}
                            <span className="ml-1.5 text-xs text-stone-400">
                              {noches} {noches === 1 ? 'noche' : 'noches'}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                        {ETIQUETAS_CANAL[r.canal as Canal] ?? r.canal}
                      </td>
                      <td
                        className={`${TD} ${COL_SECUNDARIA} tabular text-right font-medium text-stone-800`}
                      >
                        USD {Number(r.total).toLocaleString('es-AR')}
                      </td>
                      <td className={TD}>
                        <Etiqueta tono={TONO_ESTADO[r.estado]}>
                          {ETIQUETAS_ESTADO_RESERVA[r.estado]}
                        </Etiqueta>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabla>
            <Paginacion
              base="/panel/reservas"
              params={vigentes}
              pagina={pagina}
              total={total}
              tamanio={TAMANIO_PAGINA}
            />
          </>
        )}
      </Tarjeta>
    </div>
  )
}
