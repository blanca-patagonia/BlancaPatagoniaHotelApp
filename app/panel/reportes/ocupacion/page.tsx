import { requerirAcceso } from '@/lib/auth/session'
import { mesActual } from '@/lib/fechas'
import {
  metricasDeMes,
  mesRelativo,
  ultimosMeses,
  variacionPct,
  etiquetaMes,
} from '@/lib/domain/metricas'
import { formatearUSD } from '@/lib/domain/moneda'
import { mesValido } from '@/lib/domain/informes'
import { traerUnidades, traerEstadias } from '../datos'
import { SelectorDeMes, AvisoIncompleto, Variacion } from '../_componentes'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'

/** Cantidad de meses del gráfico de evolución. */
const MESES_GRAFICO = 6

/**
 * Ocupación, ADR y RevPAR.
 *
 * Los tres indicadores con los que se mide un hotel, comparados contra el mes
 * anterior y con la evolución de medio año.
 */
export default async function InformeOcupacionPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  await requerirAcceso('reportes')
  const sp = await searchParams
  const mes = mesValido(sp.mes, mesActual())

  const [unidades, estadias] = await Promise.all([traerUnidades(), traerEstadias()])
  const incompleto = unidades.truncado || estadias.truncado
  const cantidadUnidades = unidades.filas.length

  const actual = metricasDeMes(estadias.filas, mes, cantidadUnidades)
  const previo = metricasDeMes(estadias.filas, mesRelativo(mes, -1), cantidadUnidades)

  const serie = ultimosMeses(mes, MESES_GRAFICO).map((m) =>
    metricasDeMes(estadias.filas, m, cantidadUnidades),
  )
  const techoOcupacion = Math.max(10, ...serie.map((m) => m.ocupacionPct))

  return (
    <Pagina>
      <Encabezado
        titulo="Ocupación, ADR y RevPAR"
        descripcion={`Cómo viene ${etiquetaMes(mes)} contra el mes anterior.`}
        icono="ocupacion"
      />

      <AvisoIncompleto incompleto={incompleto} />

      <SelectorDeMes base="/panel/reportes/ocupacion" mes={mes} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      </div>

      {/* Evolución: columnas proporcionales al porcentaje de ocupación. */}
      <Tarjeta titulo={`Evolución de la ocupación · últimos ${MESES_GRAFICO} meses`} className="mt-6">
        <div
          className="flex items-end gap-3 px-5 pt-6 pb-4"
          role="img"
          aria-label="Gráfico de ocupación mensual"
        >
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
                ADR {m.adr ? formatearUSD(m.adr) : '—'}
              </span>
            </div>
          ))}
        </div>
      </Tarjeta>
    </Pagina>
  )
}
