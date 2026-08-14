import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ESTADOS_RESERVA,
  ETIQUETAS_ESTADO_RESERVA,
  ETIQUETAS_CANAL,
  type Canal,
  type EstadoReserva,
} from '@/lib/domain/reservas'
import { mesActual } from '@/lib/fechas'
import { traerTodo } from '@/lib/paginado'
import {
  metricasDeMes,
  mesRelativo,
  ultimosMeses,
  variacionPct,
  etiquetaMes,
  type EstadiaMetrica,
} from '@/lib/domain/metricas'
import {
  resumenNps,
  interpretarNps,
  tasaRespuesta,
  ETIQUETAS_NPS,
  CATEGORIAS_NPS,
} from '@/lib/domain/encuestas'
import { TONO_ESTADO } from '../_components/estilos'
import {
  BarraHerramientas,
  BotonExportar,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  Mensaje,
  Pagina,
} from '../_components/ui'

const RE_MES = /^\d{4}-\d{2}$/
const ESTADOS_NO_VENDIDOS: EstadoReserva[] = ['cancelada', 'no_show']
/** Cantidad de meses del gráfico de evolución. */
const MESES_GRAFICO = 6

interface ReservaRow {
  canal: string
  estado: EstadoReserva
  total: number | string
}

/** Flecha de variación contra el mes anterior. */
function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs text-stone-400">sin base previa</span>
  if (valor === 0) return <span className="text-xs text-stone-400">igual que el mes anterior</span>
  const sube = valor > 0
  return (
    <span className={`text-xs font-medium ${sube ? 'text-emerald-600' : 'text-red-600'}`}>
      {sube ? '▲' : '▼'} {Math.abs(valor)}% vs. mes anterior
    </span>
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

  const supabase = await crearClienteServidor()

  // Estas seis consultas se agregan en JavaScript sobre la tabla completa, así
  // que están expuestas al techo de PostgREST (`max_rows = 1000`): sin paginar,
  // la respuesta se recortaba en mil filas **sin error y sin aviso**, y todos los
  // indicadores de abajo —ocupación, ADR, RevPAR, ingresos— quedaban mal en
  // cuanto cualquiera de estas tablas superaba ese tamaño. Un KPI equivocado es
  // peor que ninguno: se usa para decidir.
  //
  // `traerTodo` recorre por tramos y, si aun así corta, lo informa: más abajo se
  // muestra el aviso en pantalla en vez de dar el número por bueno.
  const [unidades, estadiasRes, reservasRes, pagosRes, facturasRes, encuestasRes] =
    await Promise.all([
      traerTodo<{ id: string }>((d, h) =>
        supabase.from('unidades').select('id').eq('activo', true).order('id').range(d, h),
      ),
      traerTodo<EstadiaMetrica>((d, h) =>
        supabase
          .from('estadias')
          .select('periodo, precio_noche')
          .in('estado', ['pendiente', 'confirmada', 'pagada', 'in_house', 'checkout'])
          .order('id')
          .range(d, h),
      ),
      traerTodo<{ canal: string; estado: string; total: number }>((d, h) =>
        supabase.from('reservas').select('canal, estado, total').order('id').range(d, h),
      ),
      traerTodo<{ tipo: string; monto: number }>((d, h) =>
        supabase.from('pagos').select('tipo, monto').eq('estado', 'aprobado').order('id').range(d, h),
      ),
      traerTodo<{ total: number }>((d, h) =>
        supabase.from('facturas').select('total').order('id').range(d, h),
      ),
      traerTodo<{ puntaje: number; respondida_en: string | null }>((d, h) =>
        supabase.from('encuestas_satisfaccion').select('puntaje, respondida_en').order('id').range(d, h),
      ),
    ])

  // Si algún conjunto quedó incompleto, los números de esta pantalla no son
  // confiables y hay que decirlo.
  const datosIncompletos = [
    unidades,
    estadiasRes,
    reservasRes,
    pagosRes,
    facturasRes,
    encuestasRes,
  ].some((r) => r.truncado)

  const reservasData = reservasRes.filas
  const pagos = pagosRes.filas
  const facturas = facturasRes.filas
  const encuestas = encuestasRes.filas

  const cantidadUnidades = unidades.filas.length
  const estadias = estadiasRes.filas

  // Métricas del mes elegido y del anterior, para la comparativa.
  const actual = metricasDeMes(estadias, mes, cantidadUnidades)
  const previo = metricasDeMes(estadias, mesRelativo(mes, -1), cantidadUnidades)

  // Serie para el gráfico de evolución.
  const serie = ultimosMeses(mes, MESES_GRAFICO).map((m) =>
    metricasDeMes(estadias, m, cantidadUnidades),
  )
  const techoOcupacion = Math.max(10, ...serie.map((m) => m.ocupacionPct))

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

  // Satisfacción del huésped (NPS). Las encuestas sin responder no se cuentan
  // como cero: eso hundiría el índice (ver `lib/domain/encuestas.ts`).
  const filasEncuesta = (encuestas ?? []) as { puntaje: number | null; respondida_en: string | null }[]
  const nps = resumenNps(filasEncuesta.map((e) => e.puntaje))
  const respuesta = tasaRespuesta(
    filasEncuesta.length,
    filasEncuesta.filter((e) => e.respondida_en).length,
  )
  const maxNps = Math.max(1, nps.promotores, nps.pasivos, nps.detractores)

  return (
    <Pagina>
      <Encabezado
        titulo="Reportes"
        descripcion="Indicadores de gestión del hotel."
        icono="reportes"
        acciones={<BotonExportar href={`/panel/exportar/reportes?mes=${mes}`} titulo="Exportar serie" />}
      />

      {/*
        Antes, cuando los datos venían recortados, la pantalla mostraba los
        números igual y nadie podía saberlo. Se avisa: un indicador incompleto
        presentado como completo lleva a decidir mal.
      */}
      {datosIncompletos && (
        <Mensaje tono="error">
          Hay más datos de los que se pudieron leer de una vez, así que estos indicadores
          están calculados sobre una parte del historial y no son confiables. Avisale a
          quien mantiene el sistema: hay que pasar estas agregaciones a la base de datos.
        </Mensaje>
      )}

      <BarraHerramientas>
        <form method="get" action="/panel/reportes" className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Mes analizado</span>
            <input
              type="month"
              name="mes"
              defaultValue={mes}
              aria-label="Mes analizado"
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
            />
          </label>
          <button className={botonClases('primario')}>Ver</button>
        </form>
        <a href={`/panel/reportes?mes=${mesRelativo(mes, -1)}`} className={botonClases('secundario')}>
          ‹ Mes anterior
        </a>
        <a href={`/panel/reportes?mes=${mesRelativo(mes, 1)}`} className={botonClases('secundario')}>
          Mes siguiente ›
        </a>
      </BarraHerramientas>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Ocupación {etiquetaMes(mes)}
          </p>
          <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
            {actual.ocupacionPct}%
          </p>
          <p className="mt-1.5 text-xs text-stone-400">
            {actual.nochesVendidas} de {actual.nochesDisponibles} noches-unidad
          </p>
          <p className="mt-1">
            <Variacion valor={variacionPct(actual.ocupacionPct, previo.ocupacionPct)} />
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            ADR (tarifa media)
          </p>
          <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
            USD {actual.adr.toLocaleString('es-AR')}
          </p>
          <p className="mt-1.5 text-xs text-stone-400">por noche vendida (neto)</p>
          <p className="mt-1">
            <Variacion valor={variacionPct(actual.adr, previo.adr)} />
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">RevPAR</p>
          <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
            USD {actual.revpar.toLocaleString('es-AR')}
          </p>
          <p className="mt-1.5 text-xs text-stone-400">por unidad disponible (neto)</p>
          <p className="mt-1">
            <Variacion valor={variacionPct(actual.revpar, previo.revpar)} />
          </p>
        </div>

        <Kpi
          titulo="Ingreso alojamiento"
          valor={`USD ${Math.round(actual.ingreso).toLocaleString('es-AR')}`}
          detalle={`imputado a ${etiquetaMes(mes)}`}
          icono="reportes"
        />
        <Kpi
          titulo="Ingresos cobrados"
          valor={`USD ${ingresos.toLocaleString('es-AR')}`}
          detalle="pagos aprobados (histórico)"
          icono="ok"
          tono="exito"
        />
        <Kpi
          titulo="Facturado"
          valor={`USD ${facturado.toLocaleString('es-AR')}`}
          detalle="comprobantes emitidos"
          icono="agencias"
          tono="calafate"
        />
      </div>

      {/* Evolución: columnas proporcionales al porcentaje de ocupación. */}
      <Tarjeta
        titulo={`Evolución de la ocupación · últimos ${MESES_GRAFICO} meses`}
        className="mt-6"
      >
        <div className="flex items-end gap-3 px-5 pt-6 pb-4" role="img" aria-label="Gráfico de ocupación mensual">
          {serie.map((m) => (
            <div key={m.mes} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="tabular text-xs font-medium text-stone-600">{m.ocupacionPct}%</span>
              <div className="flex h-32 w-full items-end">
                <div
                  className={`w-full rounded-t-lg transition-all ${
                    m.mes === mes ? 'bg-lago-600' : 'bg-lago-200'
                  }`}
                  style={{ height: `${Math.max(2, (m.ocupacionPct / techoOcupacion) * 100)}%` }}
                />
              </div>
              <span
                className={`text-xs ${m.mes === mes ? 'font-semibold text-lago-800' : 'text-stone-400'}`}
              >
                {etiquetaMes(m.mes)}
              </span>
              <span className="tabular text-[10px] text-stone-400">
                ADR {m.adr ? m.adr.toLocaleString('es-AR') : '—'}
              </span>
            </div>
          ))}
        </div>
      </Tarjeta>

      {/* Satisfacción del huésped */}
      <Tarjeta
        titulo="Satisfacción del huésped (NPS)"
        descripcion="Net Promoter Score de las encuestas post check-out"
        className="mt-6"
      >
        <div className="grid gap-6 p-5 sm:grid-cols-[10rem_1fr]">
          <div className="text-center sm:text-left">
            <p className="tabular font-display text-4xl leading-none font-semibold text-stone-900">
              {nps.nps ?? '—'}
            </p>
            <p className="mt-1 text-sm font-medium text-lago-700">{interpretarNps(nps.nps)}</p>
            <p className="mt-1 text-xs text-stone-400">
              {nps.respuestas} respuesta(s)
              {respuesta !== null && ` · ${respuesta}% de respuesta`}
            </p>
            {nps.promedio !== null && (
              <p className="tabular text-xs text-stone-400">Promedio {nps.promedio} / 10</p>
            )}
          </div>

          <div className="flex flex-col justify-center gap-2">
            {CATEGORIAS_NPS.map((c) => {
              const n = c === 'promotor' ? nps.promotores : c === 'pasivo' ? nps.pasivos : nps.detractores
              const color =
                c === 'promotor' ? 'bg-emerald-500' : c === 'pasivo' ? 'bg-stone-300' : 'bg-red-500'
              return (
                <div key={c} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-stone-500">{ETIQUETAS_NPS[c]}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${(n / maxNps) * 100}%` }} />
                  </div>
                  <span className="tabular w-6 text-right font-medium text-stone-700">{n}</span>
                </div>
              )
            })}
            {nps.respuestas === 0 && (
              <p className="mt-1 text-xs text-stone-400">
                Las encuestas se generan solas al hacer el check-out de una reserva.
              </p>
            )}
          </div>
        </div>
      </Tarjeta>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Ranking de canales" descripcion="Reservas históricas por origen">
          {canales.length === 0 ? (
            <EstadoVacio titulo="Sin datos de canales" icono="reportes" />
          ) : (
            <Tabla resumen="Cantidad de reservas y monto por canal de venta">
              <thead>
                <tr>
                  <th className={TH}>Canal</th>
                  <th className={`${TH} text-right`}>Reservas</th>
                  <th className={`${TH} text-right`}>Monto (USD)</th>
                </tr>
              </thead>
              <tbody>
                {canales.map(([canal, v]) => (
                  <tr key={canal} className={FILA}>
                    <td className={`${TD} text-stone-700`}>
                      {ETIQUETAS_CANAL[canal as Canal] ?? canal}
                    </td>
                    <td className={`${TD} tabular text-right text-stone-800`}>{v.cantidad}</td>
                    <td className={`${TD} tabular text-right text-stone-800`}>
                      {v.monto.toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Tarjeta>

        <Tarjeta titulo="Reservas por estado" descripcion="Distribución histórica">
          <div className="flex flex-col gap-2 p-5">
            {ESTADOS_RESERVA.map((e) => {
              const n = porEstado.get(e) ?? 0
              return (
                <div key={e} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0">
                    <Etiqueta tono={TONO_ESTADO[e]}>{ETIQUETAS_ESTADO_RESERVA[e]}</Etiqueta>
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-lago-500"
                      style={{ width: `${(n / maxEstado) * 100}%` }}
                    />
                  </div>
                  <span className="tabular w-6 text-right font-medium text-stone-700">{n}</span>
                </div>
              )
            })}
          </div>
        </Tarjeta>
      </div>
    </Pagina>
  )
}
