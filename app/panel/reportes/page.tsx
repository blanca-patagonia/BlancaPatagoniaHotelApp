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
import { Icono } from '../_components/iconos'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import { comisionEfectivaPct, netoDeComision } from '@/lib/domain/canales-costos'
import { costoAdquisicion, totalesDeCanales } from '@/lib/domain/metricas-canal'
import {
  BarraHerramientas,
  BotonExportar,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  COL_SECUNDARIA,
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
import { formatearUSD, importe } from '@/lib/domain/moneda'

const RE_MES = /^\d{4}-\d{2}$/
const ESTADOS_NO_VENDIDOS: EstadoReserva[] = ['cancelada', 'no_show']
/** Cantidad de meses del gráfico de evolución. */
const MESES_GRAFICO = 6

interface FilaResumenCanal {
  canal: string
  reservas_totales: number
  reservas_vendidas: number
  bruto: number | string
  noches: number
  comision_informada: number | string
  sin_comision_informada: number
}

interface ReservaRow {
  canal: string
  estado: EstadoReserva
  total: number | string
}

/** Flecha de variación contra el mes anterior. */
function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs text-stone-600">sin base previa</span>
  if (valor === 0) return <span className="text-xs text-stone-600">igual que el mes anterior</span>
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

  /*
    Rentabilidad por canal, del mes elegido.

    Sale de la vista `resumen_canal_mes` (migración 0055) y NO de las reservas
    cargadas arriba, por dos razones. La agregación en memoria depende del límite de
    1000 filas de PostgREST —que es de lo que avisa el cartel de datos incompletos de
    esta misma pantalla— y además la comisión vive en `canal_cargos`, que no está en
    esa consulta.

    La vista imputa por fecha de SALIDA: es cuando se consume la estadía, y el
    criterio con el que el canal factura el mes siguiente. La pantalla lo dice.
  */
  const { data: rentabilidadData } = await supabase
    .from('resumen_canal_mes')
    .select(
      'canal, reservas_totales, reservas_vendidas, bruto, noches, comision_informada, sin_comision_informada',
    )
    .eq('mes', `${mes}-01`)

  /*
    La vista ya viene agregada por canal, así que NO se pasa por `metricasPorCanal`
    —que espera una fila por reserva y además reordena, con lo cual cualquier
    correspondencia por índice quedaría cruzada—. Se arma la métrica de cada canal con
    los mismos ayudantes puros del dominio, y se ordena por neto al final.
  */
  const metricasCanal = ((rentabilidadData ?? []) as unknown as FilaResumenCanal[])
    .map((f) => {
      const bruto = Number(f.bruto)
      const comision = Number(f.comision_informada)
      const noches = Number(f.noches)
      const neto = netoDeComision(bruto, comision)

      return {
        canal: f.canal,
        reservas: Number(f.reservas_vendidas),
        noches,
        bruto,
        comision,
        neto,
        comisionPct: comisionEfectivaPct(bruto, comision),
        adrBruto: noches > 0 ? Math.round((bruto / noches) * 100) / 100 : null,
        adrNeto: noches > 0 ? Math.round((neto / noches) * 100) / 100 : null,
        sinComisionInformada: Number(f.sin_comision_informada),
      }
    })
    // Por neto, no por bruto: la pregunta del hotel es cuál le deja más plata, y
    // ordenar por bruto pondría primero al que más factura aunque se lleve la mayor
    // comisión.
    .sort((a, b) => b.neto - a.neto)

  const totalesCanal = totalesDeCanales(metricasCanal)

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
          <p className="mt-1.5 text-xs text-stone-600">
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
            {formatearUSD(actual.adr)}
          </p>
          <p className="mt-1.5 text-xs text-stone-600">por noche vendida (neto)</p>
          <p className="mt-1">
            <Variacion valor={variacionPct(actual.adr, previo.adr)} />
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">RevPAR</p>
          <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
            {formatearUSD(actual.revpar)}
          </p>
          <p className="mt-1.5 text-xs text-stone-600">por unidad disponible (neto)</p>
          <p className="mt-1">
            <Variacion valor={variacionPct(actual.revpar, previo.revpar)} />
          </p>
        </div>

        <Kpi
          titulo="Ingreso alojamiento"
          valor={`${formatearUSD(Math.round(actual.ingreso))}`}
          detalle={`imputado a ${etiquetaMes(mes)}`}
          icono="reportes"
        />
        <Kpi
          titulo="Ingresos cobrados"
          valor={`${formatearUSD(ingresos)}`}
          detalle="pagos aprobados (histórico)"
          icono="ok"
          tono="exito"
        />
        <Kpi
          titulo="Facturado"
          valor={`${formatearUSD(facturado)}`}
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
                className={`text-xs ${m.mes === mes ? 'font-semibold text-lago-800' : 'text-stone-600'}`}
              >
                {etiquetaMes(m.mes)}
              </span>
              <span className="tabular text-[10px] text-stone-600">
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
            <p className="mt-1 text-xs text-stone-600">
              {nps.respuestas} respuesta(s)
              {respuesta !== null && ` · ${respuesta}% de respuesta`}
            </p>
            {nps.promedio !== null && (
              <p className="tabular text-xs text-stone-600">Promedio {nps.promedio} / 10</p>
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
              <p className="mt-1 text-xs text-stone-600">
                Las encuestas se generan solas al hacer el check-out de una reserva.
              </p>
            )}
          </div>
        </div>
      </Tarjeta>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Tarjeta
          titulo="Rentabilidad por canal"
          descripcion={`Qué deja cada canal en ${etiquetaMes(mes)}, después de su comisión.`}
        >
          {/*
            La advertencia que evita el error más caro de esta pantalla.

            `tarifa_tipo = 'neto'` es un TIPO DE TARIFA —la de agencia, contra la rack
            de mostrador— y NO «importe al que ya se le descontó la comisión». Sin
            decirlo acá, alguien resta la comisión de un total que creía ya neto y el
            número queda más bajo sin que nadie lo note.
          */}
          <div className="mb-4 flex gap-2 rounded-lg bg-lago-50 p-3 text-sm text-stone-700">
            <Icono nombre="ayuda" tam={16} />
            <p>
              <strong>Neto = lo que paga el huésped menos la comisión del canal.</strong> Que una
              reserva vaya a tarifa <em>neto</em> significa que se cobró a precio de agencia,{' '}
              <strong>no</strong> que ya tenga la comisión descontada. Se imputa por la fecha de{' '}
              <strong>salida</strong>, que es cuando se consume la estadía y con qué criterio
              factura el canal.
            </p>
          </div>

          {metricasCanal.length === 0 ? (
            <p className="px-5 py-4 text-sm text-stone-600">
              No hubo salidas en {etiquetaMes(mes)}.
            </p>
          ) : (
            <>
              {totalesCanal.incompleto && (
                /*
                  El neto es un PISO, no un dato cerrado. El feed iCal nunca informa
                  comisión, así que este caso es normal — y presentar el número como
                  definitivo llevaría a concluir que el canal deja más de lo que deja.
                */
                <div className="mb-4 flex gap-2 rounded-lg bg-calafate-50 p-3 text-sm text-stone-700">
                  <Icono nombre="alerta" tam={16} />
                  <p>
                    Hay <strong>{totalesCanal.sinComisionInformada}</strong>{' '}
                    {totalesCanal.sinComisionInformada === 1 ? 'reserva' : 'reservas'} sin comisión
                    informada, así que el neto es <strong>al menos</strong> este importe y no el
                    total. Para tenerla hay que subir el informe de reservas del extranet: el feed
                    iCal no la trae.
                  </p>
                </div>
              )}

              <div className="overflow-x-auto">
                <Tabla resumen="Rentabilidad por canal: reservas, bruto, comisión, neto y costo por reserva.">
                  <thead>
                    <tr className={FILA}>
                      <th className={TH}>Canal</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Reservas</th>
                      <th className={TH}>Bruto</th>
                      <th className={TH}>Comisión</th>
                      <th className={TH}>Neto</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Costo por reserva</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricasCanal.map((m) => {
                      const costo = costoAdquisicion(m)
                      return (
                        <tr key={m.canal} className={FILA}>
                          <td className={TD}>
                            <span className="font-medium text-stone-800">
                              {ETIQUETAS_CANAL[m.canal as Canal] ?? m.canal}
                            </span>
                            <span className="block text-xs text-stone-500 sm:hidden">
                              {m.reservas} reserva(s)
                            </span>
                          </td>
                          <td className={`${TD} ${COL_SECUNDARIA}`}>
                            {m.reservas.toLocaleString('es-AR')}
                          </td>
                          <td className={TD}>{importe(m.bruto)}</td>
                          <td className={TD}>
                            {m.comision > 0 ? (
                              <>
                                {importe(m.comision)}
                                {m.comisionPct !== null && (
                                  <span className="block text-xs text-stone-500">
                                    {m.comisionPct.toFixed(1)} % efectivo
                                  </span>
                                )}
                              </>
                            ) : (
                              /*
                                Sin comisión informada NO se muestra «USD 0»: eso
                                afirmaría que el canal no cobró nada.
                              */
                              <span className="text-stone-500">sin informar</span>
                            )}
                          </td>
                          <td className={TD}>
                            <span className="font-medium">{importe(m.neto)}</span>
                            {m.sinComisionInformada > 0 && (
                              <span className="block text-xs text-calafate-700">
                                al menos ({m.sinComisionInformada} sin informar)
                              </span>
                            )}
                          </td>
                          <td className={`${TD} ${COL_SECUNDARIA}`}>
                            {costo === null ? (
                              /*
                                `—` y NUNCA `USD 0`. Para directo y web el costo no es
                                cero —hay Google Ads y tiempo de mostrador— pero el
                                sistema no los conoce, y eso es distinto de que no
                                existan. Mostrar cero haría concluir que el directo es
                                gratis, y llevaría a bajar la inversión en los canales
                                pagos sin saber qué cuesta el propio.
                              */
                              <span
                                className="text-stone-400"
                                title="No hay gasto de adquisición registrado para este canal"
                              >
                                —
                              </span>
                            ) : (
                              importe(costo)
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Tabla>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-stone-100 px-5 pt-3 text-sm">
                <span className="text-stone-600">
                  Bruto <strong className="text-stone-800">{formatearUSD(totalesCanal.bruto)}</strong>
                </span>
                <span className="text-stone-600">
                  Comisión{' '}
                  <strong className="text-stone-800">{formatearUSD(totalesCanal.comision)}</strong>
                </span>
                <span className="text-stone-600">
                  Neto{' '}
                  <strong className="text-stone-800">
                    {totalesCanal.incompleto ? 'al menos ' : ''}
                    {formatearUSD(totalesCanal.neto)}
                  </strong>
                </span>
              </div>
            </>
          )}
        </Tarjeta>

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
                      {importe(v.monto)}
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
