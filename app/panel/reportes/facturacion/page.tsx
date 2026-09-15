import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { registrarErrorSync } from '@/lib/registro'
import { mesActual, inicioFinDeMes } from '@/lib/fechas'
import { mesRelativo, ultimosMeses, variacionPct, etiquetaMes } from '@/lib/domain/metricas'
import { facturadoEnPeriodo, cobradoPorMedioEnPeriodo } from '@/lib/domain/metricas-facturacion'
import { ETIQUETAS_MEDIO } from '@/lib/domain/pagos'
import { formatearUSD } from '@/lib/domain/moneda'
import { mesValido } from '@/lib/domain/informes'
import { traerFacturasConFecha, traerPagosConMedio } from '../datos'
import { SelectorDeMes, AvisoIncompleto, Variacion } from '../_componentes'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'

/** Cantidad de meses del gráfico de evolución. */
const MESES_GRAFICO = 6

/**
 * Facturación y medios de cobro.
 *
 * Dos gráficos, los dos armados con barras de CSS —el mismo patrón que ya usa
 * `reportes/ocupacion`— en vez de sumar una librería nueva solo para esto
 * (no hay ninguna instalada en el proyecto): la evolución de lo facturado mes
 * a mes, y de qué manera pagó cada huésped este mes (efectivo, tarjeta,
 * transferencia o alguna de las pasarelas: MercadoPago, Stripe, Payway).
 */
export default async function InformeFacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  await requerirAcceso('reportes')
  const sp = await searchParams
  const mes = mesValido(sp.mes, mesActual())

  const [facturas, pagos] = await Promise.all([traerFacturasConFecha(), traerPagosConMedio()])
  if (facturas.error) {
    registrarErrorSync('reportes_facturacion_lectura', { fuente: 'facturas', motivo: facturas.error })
  }
  if (pagos.error) {
    registrarErrorSync('reportes_facturacion_lectura', { fuente: 'pagos', motivo: pagos.error })
  }
  const incompleto = facturas.truncado || pagos.truncado

  const actual = facturadoEnPeriodo(facturas.filas, inicioFinDeMes(mes))
  const previo = facturadoEnPeriodo(facturas.filas, inicioFinDeMes(mesRelativo(mes, -1)))

  const serie = ultimosMeses(mes, MESES_GRAFICO).map((m) => ({
    mes: m,
    facturado: facturadoEnPeriodo(facturas.filas, inicioFinDeMes(m)),
  }))
  const techo = Math.max(1, ...serie.map((s) => s.facturado))

  const medios = cobradoPorMedioEnPeriodo(pagos.filas, inicioFinDeMes(mes))
  const techoMedios = Math.max(1, ...medios.map((m) => m.monto))

  return (
    <Pagina>
      <Link
        href="/panel/reportes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reportes
      </Link>

      <Encabezado
        titulo="Facturación y medios de cobro"
        descripcion={`Cuánto se facturó en ${etiquetaMes(mes)} y con qué pagó cada huésped.`}
        icono="reportes"
      />

      <AvisoIncompleto incompleto={incompleto} />

      <SelectorDeMes base="/panel/reportes/facturacion" mes={mes} />

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:max-w-xs">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
          Facturado en {etiquetaMes(mes)}
        </p>
        <p className="tabular mt-2 font-display text-3xl leading-none font-semibold text-stone-900">
          {formatearUSD(actual)}
        </p>
        <p className="mt-1">
          <Variacion valor={variacionPct(actual, previo)} />
        </p>
      </div>

      <Tarjeta titulo={`Evolución de la facturación · últimos ${MESES_GRAFICO} meses`} className="mt-6">
        <div className="flex items-end gap-3 px-5 pt-6 pb-4" role="img" aria-label="Gráfico de facturación mensual">
          {serie.map((s) => (
            <div key={s.mes} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="tabular text-xs font-medium text-stone-600">
                {s.facturado ? formatearUSD(s.facturado) : '—'}
              </span>
              <div className="flex h-32 w-full items-end">
                <div
                  className={`w-full rounded-t-lg transition-all ${
                    s.mes === mes ? 'bg-lago-600' : 'bg-lago-200'
                  }`}
                  style={{ height: `${Math.max(2, (s.facturado / techo) * 100)}%` }}
                />
              </div>
              <span className={`text-xs ${s.mes === mes ? 'font-semibold text-lago-800' : 'text-stone-600'}`}>
                {etiquetaMes(s.mes)}
              </span>
            </div>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta titulo={`Medios de cobro · ${etiquetaMes(mes)}`} className="mt-6">
        {medios.length === 0 ? (
          <p className="px-5 py-6 text-sm text-stone-500">No hay cobros aprobados este mes.</p>
        ) : (
          <div
            className="flex flex-col gap-3 px-5 py-5 sm:px-6"
            role="img"
            aria-label="Gráfico de cobros por medio de pago"
          >
            {medios.map((m) => (
              <div key={m.medio} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-stone-700">
                  {ETIQUETAS_MEDIO[m.medio] ?? m.medio}
                </span>
                <div className="h-4 flex-1 rounded-full bg-stone-100">
                  <div
                    className="h-4 rounded-full bg-lago-600"
                    style={{ width: `${Math.max(2, (m.monto / techoMedios) * 100)}%` }}
                  />
                </div>
                <span className="tabular w-24 shrink-0 text-right text-sm font-medium text-stone-800">
                  {formatearUSD(m.monto)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>
    </Pagina>
  )
}
