import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { construirQuery, paginaActual, rangoDePagina, terminoBusqueda } from '@/lib/listados'
import { hoyISO, sumarDias, formatoFechaCorta } from '@/lib/fechas'
import { importe } from '@/lib/domain/moneda'
import { MONEDAS_EXTRANJERAS } from '@/lib/domain/divisas'
import {
  DESCRIPCION_ESTADO_MOVIMIENTO,
  ESTADOS_MOVIMIENTO,
  ETIQUETAS_ESTADO_MOVIMIENTO,
  ETIQUETAS_ORIGEN_MOVIMIENTO,
  ORIGENES_MOVIMIENTO,
  egresosPorConcepto,
  emparejar,
  gastosPorMes,
  type EstadoMovimiento,
  type OrigenMovimiento,
  type PagoConciliable,
} from '@/lib/domain/conciliacion'
import {
  BarraHerramientas,
  Buscador,
  CAMPO,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Mensaje,
  Pagina,
  Paginacion,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  COL_SECUNDARIA,
  type Tono,
} from '../_components/ui'
import { BotonEnvio } from '../_components/boton-envio'
import { fuentesDeExtracto } from '@/lib/conciliacion'
import { proveedorMercadoPagoReportes } from '@/lib/conciliacion/mercadopago-reportes'
import { ImportarExtracto, TraerMercadoPago } from './importar'
import { resolverMovimiento } from './actions'

/**
 * Conciliación y gastos (Bloque C de la auditoría 2026-09, objetivos 4 y 10).
 *
 * ── Qué contesta esta pantalla ──────────────────────────────────────────────
 *
 * Hasta acá el sistema sabía lo que **debería** haber cobrado y no tenía forma de
 * contrastarlo contra lo que de verdad entró. Las tres preguntas que ahora sí se
 * pueden responder:
 *
 *  · ¿Hay un cobro que la pasarela hizo y el sistema no registró? (el webhook que
 *    se perdió: el sistema dice impago y la plata está en la cuenta)
 *  · ¿MercadoPago descontó la comisión que corresponde?
 *  · ¿En qué se fue la plata este mes?
 *
 * ── La regla que gobierna la pantalla ───────────────────────────────────────
 *
 * **Propone; no concilia sola.** Lo que coincide por referencia de la pasarela ya
 * se cerró al importar, porque ahí no hay ambigüedad posible. Lo que coincide sólo
 * por importe y fecha aparece como sugerencia y decide una persona.
 */

const VISTAS = ['movimientos', 'gastos'] as const
type Vista = (typeof VISTAS)[number]

const ETIQUETAS_VISTA: Record<Vista, string> = {
  movimientos: 'Movimientos',
  gastos: 'Gastos del mes',
}

const TONO_ESTADO: Record<string, Tono> = {
  sin_conciliar: 'alerta',
  conciliado: 'exito',
  ignorado: 'neutro',
}

const MENSAJES_ERROR: Record<string, string> = {
  resolver: 'No se pudo guardar. El movimiento quedó como estaba.',
  sin_pago: 'Elegí contra qué pago se concilia.',
  ignorar_motivo:
    'Escribí por qué se ignora. Un movimiento que desaparece sin explicación no lo puede revisar nadie después.',
  pago_ya_conciliado:
    'Ese pago ya está conciliado contra otro movimiento. Contarlo dos veces descuadraría el arqueo: revisá cuál de los dos corresponde.',
}

const MENSAJES_OK: Record<string, string> = {
  conciliado: 'Movimiento conciliado.',
  ignorado: 'Movimiento marcado como ignorado. Sigue contando en los gastos del mes.',
  reabierto: 'Movimiento reabierto: vuelve a figurar como pendiente.',
}

interface MovimientoRow {
  id: string
  origen: string
  cuenta: string | null
  external_id: string
  fecha: string
  descripcion: string | null
  monto: number | string
  moneda: string
  estado: string
  pago_id: string | null
  nota: string | null
}

interface PagoRow {
  id: string
  external_id: string | null
  creado_en: string
  monto: number | string
  monto_cobrado: number | string | null
  moneda: string
  reserva: { codigo: string } | null
}

/** Cuántos días de pagos se ofrecen como candidatos para conciliar a mano. */
const DIAS_CANDIDATOS = 60

export default async function ConciliacionPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string
    estado?: string
    origen?: string
    moneda?: string
    q?: string
    pagina?: string
    ok?: string
    error?: string
  }>
}) {
  await requerirAcceso('conciliacion')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const vista: Vista = (VISTAS as readonly string[]).includes(sp.vista ?? '')
    ? (sp.vista as Vista)
    : 'movimientos'
  const estado = (ESTADOS_MOVIMIENTO as readonly string[]).includes(sp.estado ?? '')
    ? (sp.estado as EstadoMovimiento)
    : undefined
  const origen = (ORIGENES_MOVIMIENTO as readonly string[]).includes(sp.origen ?? '')
    ? (sp.origen as OrigenMovimiento)
    : undefined
  const termino = terminoBusqueda(sp.q)

  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)

  let consulta = supabase
    .from('movimientos_externos')
    .select(
      'id, origen, cuenta, external_id, fecha, descripcion, monto, moneda, estado, pago_id, nota',
      { count: 'exact' },
    )
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })

  if (estado) consulta = consulta.eq('estado', estado)
  if (origen) consulta = consulta.eq('origen', origen)
  // `.ilike` con el valor pelado es seguro: viaja como parámetro y no como
  // sintaxis del filtro. `patronOr()` haría falta sólo dentro de un `.or()`.
  if (termino) consulta = consulta.ilike('descripcion', `%${termino}%`)

  const [{ data, count }, { count: pendientes }, { data: pagosData }] = await Promise.all([
    consulta.range(desde, hasta),
    supabase
      .from('movimientos_externos')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'sin_conciliar')
      .gt('monto', 0),
    /*
      Los pagos candidatos para conciliar a mano.

      Sólo los aprobados de los últimos dos meses y sin movimiento asociado: la
      lista es un `<select>` que alguien tiene que leer, y traerle el historial
      entero del hotel la vuelve inservible. `pagos.monto` está siempre en USD, así
      que se pide también `monto_cobrado`, que es lo que de verdad pasó por la
      pasarela y lo que el extracto va a mostrar (ADR 0027).
    */
    supabase
      .from('pagos')
      .select('id, external_id, creado_en, monto, monto_cobrado, moneda, reserva:reservas(codigo)')
      .eq('estado', 'aprobado')
      .gte('creado_en', sumarDias(hoyISO(), -DIAS_CANDIDATOS))
      .order('creado_en', { ascending: false })
      .limit(200),
  ])

  const movimientos = (data ?? []) as unknown as MovimientoRow[]
  const total = count ?? 0
  const pagos = (pagosData ?? []) as unknown as PagoRow[]

  const candidatosDe = (m: MovimientoRow): PagoConciliable[] => {
    const conciliables: PagoConciliable[] = pagos.map((p) => ({
      id: p.id,
      externalId: p.external_id,
      fecha: p.creado_en.slice(0, 10),
      monto: p.monto_cobrado === null ? Number(p.monto) : Number(p.monto_cobrado),
      moneda: p.moneda,
    }))
    const ids = new Set(
      emparejar(
        { externalId: m.external_id, fecha: m.fecha, monto: Number(m.monto), moneda: m.moneda },
        conciliables,
      ).map((c) => c.pagoId),
    )
    return conciliables.filter((p) => ids.has(p.id))
  }

  const etiquetaPago = (id: string): string => {
    const p = pagos.find((x) => x.id === id)
    if (!p) return id.slice(0, 8)
    const monto = p.monto_cobrado === null ? Number(p.monto) : Number(p.monto_cobrado)
    const codigo = p.reserva?.codigo ? ` · ${p.reserva.codigo}` : ''
    return `${formatoFechaCorta(p.creado_en.slice(0, 10))} · ${p.moneda} ${importe(monto)}${codigo}`
  }

  const filtros = { vista, estado, origen, q: sp.q }
  const hoy = hoyISO()

  /*
    Qué fuentes hay y qué puede hacer cada una.

    MercadoPago sólo aparece si hay credencial —la misma del cobro—, así que la
    pantalla no ofrece un botón que va a fallar. No hay variable de entorno que
    elija entre las fuentes: se usan las dos a la vez (ver `lib/conciliacion`).
  */
  const mercadoPago = proveedorMercadoPagoReportes()
  const fuentes = fuentesDeExtracto(mercadoPago ? [mercadoPago] : []).map((p) => ({
    origen: p.origen,
    ...p.capacidades(),
  }))

  return (
    <Pagina>
      <Encabezado
        titulo="Conciliación y gastos"
        descripcion="Lo que de verdad entró a la cuenta, cruzado contra lo que el sistema dice que cobró."
        icono="conciliacion"
        acciones={
          <Link href="/panel/conciliacion/gastos" className={botonClases('secundario')}>
            Gastos operativos
          </Link>
        }
      />

      {sp.error && (
        <Mensaje tono="error">
          {MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}
        </Mensaje>
      )}
      {sp.ok && <Mensaje tono="ok">{MENSAJES_OK[sp.ok] ?? 'Listo.'}</Mensaje>}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {VISTAS.map((v) => (
          <Chip
            key={v}
            href={`/panel/conciliacion${construirQuery(filtros, { vista: v, pagina: undefined })}`}
            activo={vista === v}
          >
            {ETIQUETAS_VISTA[v]}
          </Chip>
        ))}
      </div>

      {vista === 'movimientos' && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Kpi titulo="En el filtro" valor={String(total)} detalle="movimientos" icono="conciliacion" />
            <Kpi
              titulo="Sin conciliar"
              valor={String(pendientes ?? 0)}
              detalle="ingresos pendientes de revisar"
              icono="alerta"
            />
            <Kpi
              titulo="Pagos candidatos"
              valor={String(pagos.length)}
              detalle={`aprobados en ${DIAS_CANDIDATOS} días`}
              icono="reportes"
            />
          </div>

          {/*
            De dónde salen los datos, dicho por las propias fuentes.

            El texto sale de `capacidades()` y no está escrito acá: es el mismo
            patrón que la advertencia de overbooking en Canales (ADR 0021). Lo que
            se quiere evitar es que alguien suponga que el extracto del banco «se
            actualiza solo» y, el día que falte un movimiento, no sepa si falló una
            conexión o si nadie subió el archivo.
          */}
          <div className="mb-4 rounded-xl bg-stone-50 px-4 py-3 text-sm ring-1 ring-stone-200">
            <p className="font-semibold text-stone-800">Cómo entra cada fuente</p>
            <ul className="mt-2 space-y-1 text-stone-700">
              {fuentes.map((f) => (
                <li key={f.origen}>
                  <span className="font-medium">
                    {ETIQUETAS_ORIGEN_MOVIMIENTO[f.origen]}:
                  </span>{' '}
                  {f.comoLlegan}
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Tarjeta
              titulo="Subir el extracto del banco"
              descripcion="El banco no publica una forma automática de traerlo: se exporta y se sube."
              className="overflow-hidden p-0"
            >
              <ImportarExtracto monedas={['ARS', 'USD', ...MONEDAS_EXTRANJERAS.filter((m) => m !== 'ARS')]} />
            </Tarjeta>

            <Tarjeta
              titulo="Traer de MercadoPago"
              descripcion="Reporte de liquidaciones: lo acreditado, ya descontada la comisión."
              className="overflow-hidden p-0"
            >
              <TraerMercadoPago desde={sumarDias(hoy, -30)} hasta={hoy} />
            </Tarjeta>
          </div>

          <BarraHerramientas>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                href={`/panel/conciliacion${construirQuery(filtros, { estado: undefined, pagina: undefined })}`}
                activo={!estado}
              >
                Todos
              </Chip>
              {ESTADOS_MOVIMIENTO.map((e) => (
                <Chip
                  key={e}
                  href={`/panel/conciliacion${construirQuery(filtros, { estado: e, pagina: undefined })}`}
                  activo={estado === e}
                >
                  {ETIQUETAS_ESTADO_MOVIMIENTO[e]}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ORIGENES_MOVIMIENTO.map((o) => (
                <Chip
                  key={o}
                  href={`/panel/conciliacion${construirQuery(filtros, {
                    origen: origen === o ? undefined : o,
                    pagina: undefined,
                  })}`}
                  activo={origen === o}
                >
                  {ETIQUETAS_ORIGEN_MOVIMIENTO[o]}
                </Chip>
              ))}
            </div>
            <Buscador
              accion="/panel/conciliacion"
              valor={sp.q ?? ''}
              etiqueta="Buscar en la descripción"
              placeholder="transferencia, lavandería…"
              ocultos={{ vista, estado, origen }}
            />
            {(estado || origen || termino) && (
              <Link href="/panel/conciliacion" className={botonClases('fantasma')}>
                Limpiar
              </Link>
            )}
          </BarraHerramientas>

          {estado && (
            <p className="mb-3 text-sm text-stone-600">{DESCRIPCION_ESTADO_MOVIMIENTO[estado]}</p>
          )}

          <Tarjeta className="overflow-hidden p-0">
            {movimientos.length === 0 ? (
              <EstadoVacio
                titulo={estado || origen || termino ? 'Sin resultados' : 'Todavía no hay movimientos'}
                descripcion={
                  estado || origen || termino
                    ? 'Probá con otro filtro.'
                    : 'Subí el extracto del banco o traé la liquidación de MercadoPago para empezar.'
                }
                icono="conciliacion"
              />
            ) : (
              <>
                <Tabla resumen="Movimientos de la cuenta con fecha, descripción, importe, estado y la acción para conciliarlos.">
                  <thead>
                    <tr className={FILA}>
                      <th className={TH}>Fecha</th>
                      <th className={TH}>Descripción</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Origen</th>
                      <th className={TH}>Importe</th>
                      <th className={TH}>Estado</th>
                      <th className={TH}>Resolver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.map((m) => {
                      const monto = Number(m.monto)
                      const entrante = monto > 0
                      const candidatos = entrante && m.estado === 'sin_conciliar' ? candidatosDe(m) : []

                      return (
                        <tr key={m.id} className={FILA}>
                          <td className={`${TD} tabular whitespace-nowrap text-stone-500`}>
                            {formatoFechaCorta(m.fecha)}
                          </td>
                          <td className={TD}>
                            <span className="text-stone-800">{m.descripcion || 'Sin descripción'}</span>
                            {/* En móvil el origen no tiene columna: se pliega acá. */}
                            <span className="block text-xs text-stone-500 sm:hidden">
                              {ETIQUETAS_ORIGEN_MOVIMIENTO[m.origen as OrigenMovimiento] ?? m.origen}
                            </span>
                            {m.cuenta && (
                              <span className="block text-xs text-stone-500">{m.cuenta}</span>
                            )}
                            {m.nota && <span className="block text-xs text-stone-500">{m.nota}</span>}
                            {m.pago_id && (
                              <span className="block text-xs text-stone-500">
                                Pago: {etiquetaPago(m.pago_id)}
                              </span>
                            )}
                          </td>
                          <td className={`${TD} ${COL_SECUNDARIA}`}>
                            {ETIQUETAS_ORIGEN_MOVIMIENTO[m.origen as OrigenMovimiento] ?? m.origen}
                          </td>
                          {/*
                            El signo se muestra con color Y con el signo escrito, no
                            sólo con color: quien no distingue rojo de verde tiene
                            que poder leer si entró o salió.
                          */}
                          <td className={`${TD} tabular whitespace-nowrap`}>
                            <span className={entrante ? 'text-emerald-700' : 'text-stone-800'}>
                              {entrante ? '+' : '−'} {m.moneda} {importe(Math.abs(monto))}
                            </span>
                          </td>
                          <td className={TD}>
                            <Etiqueta tono={TONO_ESTADO[m.estado] ?? 'neutro'}>
                              {ETIQUETAS_ESTADO_MOVIMIENTO[m.estado as EstadoMovimiento] ?? m.estado}
                            </Etiqueta>
                          </td>
                          <td className={TD}>
                            {m.estado === 'sin_conciliar' ? (
                              <form
                                action={resolverMovimiento}
                                className="flex flex-wrap items-end gap-1.5"
                              >
                                <input type="hidden" name="movimiento_id" value={m.id} />
                                {candidatos.length > 0 && (
                                  <label className="flex flex-col gap-1 text-xs">
                                    <span className="sr-only">Pago con el que se corresponde</span>
                                    <select name="pago_id" defaultValue="" className={CAMPO}>
                                      <option value="">Elegí el pago…</option>
                                      {candidatos.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {etiquetaPago(p.id)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                                <label className="flex flex-col gap-1 text-xs">
                                  <span className="sr-only">Nota</span>
                                  <input
                                    name="nota"
                                    maxLength={500}
                                    placeholder={
                                      candidatos.length > 0 ? 'Nota (opcional)' : 'Motivo para ignorar'
                                    }
                                    className={`${CAMPO} w-40`}
                                  />
                                </label>
                                {candidatos.length > 0 && (
                                  <BotonEnvio
                                    variante="secundario"
                                    cargando="Guardando…"
                                    name="accion"
                                    value="conciliar"
                                  >
                                    Conciliar
                                  </BotonEnvio>
                                )}
                                <BotonEnvio
                                  variante="fantasma"
                                  cargando="Guardando…"
                                  name="accion"
                                  value="ignorar"
                                >
                                  Ignorar
                                </BotonEnvio>
                              </form>
                            ) : (
                              <form action={resolverMovimiento}>
                                <input type="hidden" name="movimiento_id" value={m.id} />
                                <input type="hidden" name="accion" value="reabrir" />
                                <BotonEnvio variante="fantasma" cargando="Guardando…">
                                  Reabrir
                                </BotonEnvio>
                              </form>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Tabla>
                <Paginacion
                  pagina={pagina}
                  total={total}
                  base="/panel/conciliacion"
                  params={{ vista, estado, origen, q: sp.q }}
                />
              </>
            )}
          </Tarjeta>
        </>
      )}

      {vista === 'gastos' && <VistaGastos />}
    </Pagina>
  )
}

/**
 * Gastos del mes (objetivo 10 del pedido).
 *
 * ⚠️ Se agrupa **por moneda**. Sumar pesos con dólares en un mismo total daría un
 * número que no significa nada, y con la inflación argentina el error ni siquiera
 * se ve raro. Cada moneda tiene su propia tabla.
 */
async function VistaGastos() {
  const supabase = await crearClienteServidor()

  /*
    Doce meses hacia atrás.

    Alcanza para comparar contra la misma temporada del año anterior, que es la
    comparación que le importa a un hotel estacional, y acota la lectura muy por
    debajo del corte de 1000 filas de PostgREST para un hotel de este tamaño.
  */
  const desde = sumarDias(hoyISO(), -365)
  const { data, error } = await supabase
    .from('movimientos_externos')
    .select('fecha, monto, moneda, descripcion')
    .gte('fecha', desde)
    .order('fecha', { ascending: false })

  if (error) {
    return (
      <Mensaje tono="error">
        No se pudieron leer los movimientos para armar el resumen. Probá de nuevo.
      </Mensaje>
    )
  }

  const filas = (data ?? []) as {
    fecha: string
    monto: number | string
    moneda: string
    descripcion: string | null
  }[]

  if (filas.length === 0) {
    return (
      <Tarjeta className="overflow-hidden p-0">
        <EstadoVacio
          titulo="Todavía no hay nada que resumir"
          descripcion="Los gastos salen de los movimientos de la cuenta. Subí el extracto del banco para verlos."
          icono="conciliacion"
        />
      </Tarjeta>
    )
  }

  const monedas = [...new Set(filas.map((f) => f.moneda))].sort()

  return (
    <div className="grid gap-4">
      {monedas.map((moneda) => {
        const delaMoneda = filas
          .filter((f) => f.moneda === moneda)
          .map((f) => ({
            fecha: f.fecha,
            monto: Number(f.monto),
            descripcion: f.descripcion ?? '',
          }))
        const meses = gastosPorMes(delaMoneda).slice(0, 12)
        const conceptos = egresosPorConcepto(delaMoneda)

        return (
          <Tarjeta
            key={moneda}
            titulo={`Movimientos en ${moneda}`}
            descripcion="Cada moneda va por separado: sumarlas daría un total sin sentido."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-x-auto">
                <Tabla resumen={`Ingresos, egresos y neto por mes, en ${moneda}.`}>
                  <thead>
                    <tr className={FILA}>
                      <th className={TH}>Mes</th>
                      <th className={TH}>Gastos</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Ingresos</th>
                      <th className={TH}>Neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meses.map((m) => (
                      <tr key={m.mes} className={FILA}>
                        <td className={`${TD} tabular whitespace-nowrap`}>{m.mes}</td>
                        <td className={`${TD} tabular text-stone-800`}>{importe(m.egresos)}</td>
                        <td className={`${TD} ${COL_SECUNDARIA} tabular text-emerald-700`}>
                          {importe(m.ingresos)}
                        </td>
                        <td
                          className={`${TD} tabular ${m.neto < 0 ? 'text-red-700' : 'text-stone-800'}`}
                        >
                          {m.neto < 0 ? '−' : ''}
                          {importe(Math.abs(m.neto))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
              </div>

              <div className="overflow-x-auto">
                <p className="mb-2 text-sm text-stone-600">
                  En qué se fue la plata, agrupado por lo que dice el banco. No se clasifica solo:
                  un clasificador que se equivoca esconde el gasto en la categoría equivocada.
                </p>
                {conceptos.length === 0 ? (
                  <p className="text-sm text-stone-500">No hay egresos en esta moneda.</p>
                ) : (
                  <Tabla resumen={`Principales conceptos de gasto en ${moneda}.`}>
                    <thead>
                      <tr className={FILA}>
                        <th className={TH}>Concepto</th>
                        <th className={`${TH} ${COL_SECUNDARIA}`}>Movimientos</th>
                        <th className={TH}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conceptos.map((c) => (
                        <tr key={c.concepto} className={FILA}>
                          <td className={TD}>{c.concepto}</td>
                          <td className={`${TD} ${COL_SECUNDARIA} tabular`}>{c.movimientos}</td>
                          <td className={`${TD} tabular`}>{importe(c.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabla>
                )}
              </div>
            </div>
          </Tarjeta>
        )
      })}
    </div>
  )
}
