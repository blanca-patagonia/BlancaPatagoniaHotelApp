import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ETIQUETAS_ESTADO_RESERVA,
  ESTADOS_RESERVA,
  CANALES,
  ETIQUETAS_CANAL,
  ETIQUETAS_GARANTIA,
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  GARANTIAS,
  PLANES,
  SEGMENTOS,
  type EstadoReserva,
  type Canal,
} from '@/lib/domain/reservas'
import { resumenPagos, type EstadoPago, type TipoPago } from '@/lib/domain/pagos'
import {
  ORDEN_CHIPS,
  VISTAS,
  definicionDe,
  esVista,
  type VistaReservas,
} from '@/lib/domain/vistas-reservas'
import { parsearPeriodo, formatoFechaCorta, diasEntre, hoyISO } from '@/lib/fechas'
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
  /** Neto sin IVA (paso 6): permite mostrar la tarifa con o sin impuestos. */
  total_neto: number | string
  iva: number | string
  canal: string
  plan: string
  garantia: string
  segmento: string
  creada_en: string
  grupo_id: string | null
  agencia_id: string | null
  huesped: { apellido: string; nombre: string; email: string | null; vip: boolean } | null
  estadias: {
    periodo: string
    check_in: string
    check_out: string
    huespedes: number
    adultos: number
    menores: number
    bebes: number
  }[]
  pagos: { tipo: TipoPago; monto: number | string; estado: EstadoPago }[]
}

interface Params {
  q?: string
  estado?: string
  canal?: string
  desde?: string
  hasta?: string
  grupo?: string
  vista?: string
  plan?: string
  garantia?: string
  segmento?: string
  /** `sin` muestra los importes sin IVA. Por omisión, con IVA (lo que se cobra). */
  impuestos?: string
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
  const vista: VistaReservas | undefined = esVista(sp.vista) ? sp.vista : undefined

  // El día de referencia se resuelve una sola vez y se pasa a la consulta, para
  // que la pantalla y el export CSV no puedan quedar en días distintos si la
  // petición cruza la medianoche.
  const hoy = hoyISO()

  // Cortes comerciales (paso 6). Se validan contra las listas del dominio para
  // que un valor inventado en la URL no llegue a la consulta.
  const plan = (PLANES as readonly string[]).includes(sp.plan ?? '') ? sp.plan : undefined
  const garantia = (GARANTIAS as readonly string[]).includes(sp.garantia ?? '')
    ? sp.garantia
    : undefined
  const segmento = (SEGMENTOS as readonly string[]).includes(sp.segmento ?? '')
    ? sp.segmento
    : undefined

  /** Los importes se muestran sin IVA sólo si se pide. Por omisión, lo que se cobra. */
  const sinImpuestos = sp.impuestos === 'sin'

  const filtros = {
    q: sp.q,
    estado,
    canal,
    desde: sp.desde,
    hasta: sp.hasta,
    grupo: sp.grupo,
    vista,
    plan,
    garantia,
    segmento,
    hoy,
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
    vista,
    plan,
    garantia,
    segmento,
    impuestos: sp.impuestos,
  }
  const hayFiltros = Object.values(vigentes).some(Boolean)

  /** Importe a mostrar según el interruptor de impuestos. */
  const importeDe = (r: Row) => (sinImpuestos ? Number(r.total_neto) : Number(r.total))

  // ── Totales del pie ────────────────────────────────────────────────────────
  // El listado de WinPAX cerraba con los totales de lo que estás viendo. Se
  // calculan sobre la PÁGINA, no sobre el resultado completo, y la pantalla lo
  // dice: sumar el total real exigiría traer todas las filas, que es justo lo que
  // la paginación evita (y `max_rows` cortaría en 1000 sin avisar).
  const saldos = reservas.map((r) =>
    resumenPagos(
      Number(r.total),
      (r.pagos ?? []).map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado })),
    ),
  )
  const totalPagina = reservas.reduce((acc, r) => acc + (sinImpuestos ? Number(r.total_neto) : Number(r.total)), 0)
  const saldoPagina = saldos.reduce((acc, s) => acc + s.saldo, 0)
  const totalGrupo = sp.grupo ? totalPagina : 0

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
            <span className="text-stone-600">y</span>
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
          {/* ── Cortes comerciales (paso 6) ─────────────────────────────────
              Los tres filtros que WinPAX tenía y que el paso 3 no pudo hacer:
              las columnas no existían. */}
          <select
            name="plan"
            defaultValue={plan ?? ''}
            aria-label="Plan o pensión"
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
          >
            <option value="">Todos los planes</option>
            {PLANES.map((p) => (
              <option key={p} value={p}>
                {ETIQUETAS_PLAN[p]}
              </option>
            ))}
          </select>
          <select
            name="garantia"
            defaultValue={garantia ?? ''}
            aria-label="Garantía"
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
          >
            <option value="">Toda garantía</option>
            {GARANTIAS.map((g) => (
              <option key={g} value={g}>
                {ETIQUETAS_GARANTIA[g]}
              </option>
            ))}
          </select>
          <select
            name="segmento"
            defaultValue={segmento ?? ''}
            aria-label="Segmento"
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
          >
            <option value="">Todo segmento</option>
            {SEGMENTOS.map((s) => (
              <option key={s} value={s}>
                {ETIQUETAS_SEGMENTO[s]}
              </option>
            ))}
          </select>
          <button type="submit" className={botonClases('secundario')}>
            Aplicar
          </button>
        </form>

        {/* Interruptor de impuestos. Es un enlace y no un `select` porque cambia
            cómo se lee toda la tabla, y así el estado queda en la URL: quien
            comparta el enlace comparte la misma vista. Dice qué está mostrando,
            no qué haría al apretarlo. */}
        <Chip
          href={`/panel/reservas${construirQuery(vigentes, { impuestos: sinImpuestos ? undefined : 'sin', pagina: undefined })}`}
          activo={sinImpuestos}
        >
          {sinImpuestos ? 'Mostrando sin IVA' : 'Mostrando con IVA'}
        </Chip>

        {hayFiltros && (
          <Link href="/panel/reservas" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      {/* ── Vistas operativas ───────────────────────────────────────────────
          Los filtros del día de recepción. Cuatro de ellos no son estados:
          «llegadas hoy» y «salidas hoy» son consultas por fecha, «grupos» y
          «particulares» por agrupación comercial. Por eso no podían ser chips de
          estado y hacía falta la migración 0037.

          Elegir una vista LIMPIA el chip de estado (y al revés): si se aplicaran
          las dos, el resultado podría quedar vacío sin que se entienda por qué. */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Chip
          href={`/panel/reservas${construirQuery(vigentes, { vista: undefined, estado: undefined, pagina: undefined })}`}
          activo={!vista && !estado}
        >
          Todas
        </Chip>
        {ORDEN_CHIPS.map((v) => (
          <Chip
            key={v}
            href={`/panel/reservas${construirQuery(vigentes, { vista: v, estado: undefined, pagina: undefined })}`}
            activo={vista === v}
          >
            {VISTAS[v].etiqueta}
          </Chip>
        ))}
      </div>

      {/* Los chips de estado quedan como corte secundario, con su etiqueta a la
          vista: sirven para aislar un estado puntual. No se esconden detrás de un
          desplegable — el proyecto lo prohíbe (Fase 15: nada oculto). */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-stone-500">Por estado:</span>
        {ESTADOS_RESERVA.map((e) => (
          <Chip
            key={e}
            href={`/panel/reservas${construirQuery(vigentes, { estado: e, vista: undefined, pagina: undefined })}`}
            activo={estado === e}
          >
            {ETIQUETAS_ESTADO_RESERVA[e]}
          </Chip>
        ))}
      </div>

      <Tarjeta className="overflow-hidden">
        {reservas.length === 0 ? (
          <EstadoVacio
            titulo={
              vista
                ? VISTAS[vista].etiqueta
                : hayFiltros
                  ? 'Ninguna reserva coincide con la búsqueda'
                  : 'Todavía no hay reservas'
            }
            descripcion={
              /* Con una vista activa el mensaje dice el hecho operativo («no hay
                 llegadas previstas para hoy»), no «no hay resultados»: es una
                 respuesta útil, no un error. */
              vista
                ? definicionDe(vista).vacio
                : hayFiltros
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
                  <th className={`${TH} ${COL_SECUNDARIA} text-right`}>{sinImpuestos ? 'Total sin IVA' : 'Total'}</th>
                  <th className={`${TH} text-right`}>Saldo</th>
                  <th className={TH}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {reservas.map((r, i) => {
                  const periodo = r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo) : null
                  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
                  const pago = saldos[i]
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
                        {/* VIP con estrella Y texto accesible: el símbolo solo se
                            pierde para quien usa lector de pantalla. */}
                        {r.huesped?.vip && (
                          <span className="ml-1.5 font-semibold text-calafate-700" title="Huésped VIP">
                            ★<span className="sr-only"> Huésped VIP</span>
                          </span>
                        )}
                        {/* En el teléfono las columnas de fechas y total se
                            ocultan, pero las fechas son justo lo que recepción
                            necesita ver de un vistazo: se pliegan acá abajo. */}
                        {periodo && (
                          <span className="tabular block text-xs text-stone-500 sm:hidden">
                            {formatoFechaCorta(periodo.desde)} → {formatoFechaCorta(periodo.hasta)}
                            {' · USD '}
                            {importeDe(r).toLocaleString('es-AR')}
                          </span>
                        )}
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                        {periodo ? (
                          <>
                            {formatoFechaCorta(periodo.desde)} → {formatoFechaCorta(periodo.hasta)}
                            <span className="ml-1.5 text-xs text-stone-600">
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
                        USD {importeDe(r).toLocaleString('es-AR')}
                      </td>
                      {/* Saldo: la columna que decide si hay que llamar al
                          huésped. «Saldada» va con texto y no sólo en verde, para
                          que se lea sin distinguir colores. */}
                      <td className={`${TD} tabular text-right`}>
                        {pago.saldada ? (
                          <span className="text-xs font-medium text-emerald-700">Saldada</span>
                        ) : (
                          <span className="font-semibold text-stone-900">
                            USD {pago.saldo.toLocaleString('es-AR')}
                          </span>
                        )}
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

              {/* Totales de lo que se está viendo, como cerraba el listado de
                  WinPAX. Dice «en esta página» a propósito: sumar el resultado
                  completo exigiría traer todas las filas, que es justo lo que la
                  paginación evita — y `max_rows` cortaría en 1000 sin avisar. */}
              <tfoot className="border-t-2 border-stone-300 bg-stone-50 text-sm">
                <tr>
                  <th scope="row" colSpan={2} className="px-4 py-2.5 text-left font-medium text-stone-600">
                    Totales de esta página
                    <span className="ml-1 text-xs font-normal text-stone-500">
                      ({reservas.length} de {total})
                    </span>
                  </th>
                  <td className={COL_SECUNDARIA} />
                  <td className={COL_SECUNDARIA} />
                  <td className={`${COL_SECUNDARIA} tabular px-4 py-2.5 text-right font-semibold text-stone-900`}>
                    USD {totalPagina.toLocaleString('es-AR')}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold text-stone-900">
                    USD {saldoPagina.toLocaleString('es-AR')}
                  </td>
                  <td />
                </tr>
              </tfoot>
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
