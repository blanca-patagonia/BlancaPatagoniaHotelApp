import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { registrarErrorSync } from '@/lib/registro'
import { mesActual, semanaActual } from '@/lib/fechas'
import {
  metricasDeMes,
  metricasDeSemana,
  mesRelativo,
  semanaRelativa,
  ultimosMeses,
  ultimasSemanas,
  variacionPct,
  etiquetaMes,
  etiquetaSemana,
} from '@/lib/domain/metricas'
import { formatearUSD } from '@/lib/domain/moneda'
import { mesValido, semanaValida } from '@/lib/domain/informes'
import { traerUnidades, traerEstadias } from '../datos'
import { SelectorDeMes, SelectorDeSemana, SelectorDeVista, AvisoIncompleto, Variacion } from '../_componentes'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'

/** Cantidad de columnas del gráfico de evolución, en cada vista. */
const MESES_GRAFICO = 6
const SEMANAS_GRAFICO = 8

/**
 * Ocupación, ADR y RevPAR.
 *
 * Los tres indicadores con los que se mide un hotel, comparados contra el
 * período anterior y con la evolución reciente. Admite dos vistas —mensual
 * (por defecto) y semanal, pedida por el hotel para seguir la ocupación con
 * más frecuencia que una vez al mes— sin duplicar el cálculo: las dos usan
 * `metricasDePeriodo` por debajo (`lib/domain/metricas.ts`).
 */
export default async function InformeOcupacionPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; semana?: string; vista?: string }>
}) {
  await requerirAcceso('reportes')
  const sp = await searchParams
  const vista = sp.vista === 'semanal' ? 'semanal' : 'mensual'

  const [unidades, estadias] = await Promise.all([traerUnidades(), traerEstadias()])
  if (unidades.error) registrarErrorSync('reportes_ocupacion_lectura', { fuente: 'unidades', motivo: unidades.error })
  if (estadias.error) registrarErrorSync('reportes_ocupacion_lectura', { fuente: 'estadias', motivo: estadias.error })
  const incompleto = unidades.truncado || estadias.truncado
  const cantidadUnidades = unidades.filas.length

  return (
    <Pagina>
      <Link
        href="/panel/reportes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reportes
      </Link>

      <Encabezado
        titulo="Ocupación, ADR y RevPAR"
        descripcion="Los tres indicadores con los que se mide un hotel, mes a mes o semana a semana."
        icono="ocupacion"
      />

      <AvisoIncompleto incompleto={incompleto} />

      <SelectorDeVista base="/panel/reportes/ocupacion" vista={vista} />

      {vista === 'mensual' ? (
        <VistaMensual mes={mesValido(sp.mes, mesActual())} estadias={estadias.filas} cantidadUnidades={cantidadUnidades} />
      ) : (
        <VistaSemanal
          semana={semanaValida(sp.semana, semanaActual())}
          estadias={estadias.filas}
          cantidadUnidades={cantidadUnidades}
        />
      )}
    </Pagina>
  )
}

function VistaMensual({
  mes,
  estadias,
  cantidadUnidades,
}: {
  mes: string
  estadias: Parameters<typeof metricasDeMes>[0]
  cantidadUnidades: number
}) {
  const actual = metricasDeMes(estadias, mes, cantidadUnidades)
  const previo = metricasDeMes(estadias, mesRelativo(mes, -1), cantidadUnidades)
  const serie = ultimosMeses(mes, MESES_GRAFICO).map((m) => metricasDeMes(estadias, m, cantidadUnidades))
  const techoOcupacion = Math.max(10, ...serie.map((m) => m.ocupacionPct))

  return (
    <>
      <SelectorDeMes base="/panel/reportes/ocupacion" mes={mes} />

      <TarjetasKpi actual={actual} previo={previo} etiquetaActual={etiquetaMes(mes)} />

      <Tarjeta titulo={`Evolución de la ocupación · últimos ${MESES_GRAFICO} meses`} className="mt-6">
        <div className="flex items-end gap-3 px-5 pt-6 pb-4" role="img" aria-label="Gráfico de ocupación mensual">
          {serie.map((m) => (
            <ColumnaEvolucion
              key={m.mes}
              activa={m.mes === mes}
              etiqueta={etiquetaMes(m.mes)}
              ocupacionPct={m.ocupacionPct}
              adr={m.adr}
              techoOcupacion={techoOcupacion}
            />
          ))}
        </div>
      </Tarjeta>
    </>
  )
}

function VistaSemanal({
  semana,
  estadias,
  cantidadUnidades,
}: {
  semana: string
  estadias: Parameters<typeof metricasDeSemana>[0]
  cantidadUnidades: number
}) {
  const actual = metricasDeSemana(estadias, semana, cantidadUnidades)
  const previo = metricasDeSemana(estadias, semanaRelativa(semana, -1), cantidadUnidades)
  const serie = ultimasSemanas(semana, SEMANAS_GRAFICO).map((s) => metricasDeSemana(estadias, s, cantidadUnidades))
  const techoOcupacion = Math.max(10, ...serie.map((s) => s.ocupacionPct))

  return (
    <>
      <SelectorDeSemana base="/panel/reportes/ocupacion" semana={semana} />

      <TarjetasKpi
        actual={actual}
        previo={previo}
        etiquetaActual={etiquetaSemana(semana)}
        etiquetaBase="la semana anterior"
      />

      <Tarjeta titulo={`Evolución de la ocupación · últimas ${SEMANAS_GRAFICO} semanas`} className="mt-6">
        <div className="flex items-end gap-3 px-5 pt-6 pb-4" role="img" aria-label="Gráfico de ocupación semanal">
          {serie.map((s) => (
            <ColumnaEvolucion
              key={s.semana}
              activa={s.semana === semana}
              etiqueta={etiquetaSemana(s.semana)}
              ocupacionPct={s.ocupacionPct}
              adr={s.adr}
              techoOcupacion={techoOcupacion}
            />
          ))}
        </div>
      </Tarjeta>
    </>
  )
}

function TarjetasKpi({
  actual,
  previo,
  etiquetaActual,
  etiquetaBase,
}: {
  actual: { ocupacionPct: number; nochesVendidas: number; nochesDisponibles: number; adr: number; revpar: number }
  previo: { ocupacionPct: number; adr: number; revpar: number }
  etiquetaActual: string
  etiquetaBase?: string
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">Ocupación {etiquetaActual}</p>
        <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
          {actual.ocupacionPct}%
        </p>
        <p className="mt-1.5 text-xs text-stone-600">
          {actual.nochesVendidas} de {actual.nochesDisponibles} noches-unidad
        </p>
        <p className="mt-1">
          <Variacion valor={variacionPct(actual.ocupacionPct, previo.ocupacionPct)} etiquetaBase={etiquetaBase} />
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">ADR (tarifa media)</p>
        <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
          {formatearUSD(actual.adr)}
        </p>
        <p className="mt-1.5 text-xs text-stone-600">por noche vendida (neto)</p>
        <p className="mt-1">
          <Variacion valor={variacionPct(actual.adr, previo.adr)} etiquetaBase={etiquetaBase} />
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">RevPAR</p>
        <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
          {formatearUSD(actual.revpar)}
        </p>
        <p className="mt-1.5 text-xs text-stone-600">por unidad disponible (neto)</p>
        <p className="mt-1">
          <Variacion valor={variacionPct(actual.revpar, previo.revpar)} etiquetaBase={etiquetaBase} />
        </p>
      </div>
    </div>
  )
}

/** Una columna del gráfico de evolución (barra proporcional al % de ocupación). */
function ColumnaEvolucion({
  activa,
  etiqueta,
  ocupacionPct,
  adr,
  techoOcupacion,
}: {
  activa: boolean
  etiqueta: string
  ocupacionPct: number
  adr: number
  techoOcupacion: number
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <span className="tabular text-xs font-medium text-stone-600">{ocupacionPct}%</span>
      <div className="flex h-32 w-full items-end">
        <div
          className={`w-full rounded-t-lg transition-all ${activa ? 'bg-lago-600' : 'bg-lago-200'}`}
          style={{ height: `${Math.max(2, (ocupacionPct / techoOcupacion) * 100)}%` }}
        />
      </div>
      <span className={`text-xs ${activa ? 'font-semibold text-lago-800' : 'text-stone-600'}`}>{etiqueta}</span>
      <span className="tabular text-[10px] text-stone-600">ADR {adr ? formatearUSD(adr) : '—'}</span>
    </div>
  )
}
