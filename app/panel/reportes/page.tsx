import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { mesActual } from '@/lib/fechas'
import { metricasDeMes, etiquetaMes } from '@/lib/domain/metricas'
import { formatearUSD } from '@/lib/domain/moneda'
import { INFORMES, rutaDeInforme, mesValido } from '@/lib/domain/informes'
import { traerUnidades, traerEstadias, traerPagos, traerFacturas } from './datos'
import { SelectorDeMes, AvisoIncompleto, AbrirAparte } from './_componentes'
import {
  BotonExportar,
  Encabezado,
  Kpi,
  Pagina,
  Tarjeta,
  botonClases,
} from '../_components/ui'

/**
 * Índice de informes.
 *
 * Antes todos los informes vivían en esta única pantalla, con **un solo filtro
 * de mes** para los seis. El hotel pidió poder usar varios a la vez sin cerrar
 * ninguno —en WinPAX las ventanas son modales— y acá el problema equivalente
 * era ése: no se podía mirar la venta por categoría de agosto al lado de la
 * rentabilidad por canal de septiembre.
 *
 * Ahora cada informe tiene su propia dirección y sus propios filtros. Esta
 * pantalla queda como punto de partida: los tres indicadores del mes de un
 * vistazo, y desde acá se abre cada informe —en esta pestaña o en otra—.
 */
export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  await requerirAcceso('reportes')
  const sp = await searchParams
  const mes = mesValido(sp.mes, mesActual())

  // El índice trae lo justo para los tres números de arriba. El detalle de cada
  // informe lo pide el informe: antes esta pantalla leía seis tablas completas
  // aunque sólo se quisiera mirar el NPS.
  const [unidades, estadias, pagos, facturas] = await Promise.all([
    traerUnidades(),
    traerEstadias(),
    traerPagos(),
    traerFacturas(),
  ])

  const incompleto = [unidades, estadias, pagos, facturas].some((r) => r.truncado)
  const actual = metricasDeMes(estadias.filas, mes, unidades.filas.length)

  let ingresos = 0
  for (const p of pagos.filas) {
    ingresos += p.tipo === 'reembolso' ? -Number(p.monto) : Number(p.monto)
  }
  const facturado = facturas.filas.reduce((acc, f) => acc + Number(f.total), 0)

  return (
    <Pagina>
      <Encabezado
        titulo="Reportes"
        descripcion="Indicadores de gestión del hotel. Cada informe se abre por separado."
        icono="reportes"
        acciones={
          <BotonExportar href={`/panel/exportar/reportes?mes=${mes}`} titulo="Exportar serie" />
        }
      />

      <AvisoIncompleto incompleto={incompleto} />

      <SelectorDeMes base="/panel/reportes" mes={mes} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Kpi
          titulo={`Ocupación ${etiquetaMes(mes)}`}
          valor={`${actual.ocupacionPct}%`}
          detalle={`${actual.nochesVendidas} de ${actual.nochesDisponibles} noches-unidad`}
          icono="ocupacion"
        />
        <Kpi
          titulo="ADR (tarifa media)"
          valor={formatearUSD(actual.adr)}
          detalle="por noche vendida (neto)"
          icono="reportes"
        />
        <Kpi
          titulo="RevPAR"
          valor={formatearUSD(actual.revpar)}
          detalle="por unidad disponible (neto)"
          icono="reportes"
        />
        <Kpi
          titulo="Ingreso alojamiento"
          valor={formatearUSD(Math.round(actual.ingreso))}
          detalle={`imputado a ${etiquetaMes(mes)}`}
          icono="reportes"
        />
        <Kpi
          titulo="Ingresos cobrados"
          valor={formatearUSD(ingresos)}
          detalle="pagos aprobados (histórico)"
          icono="ok"
          tono="exito"
        />
        <Kpi
          titulo="Facturado"
          valor={formatearUSD(facturado)}
          detalle="comprobantes emitidos"
          icono="agencias"
          tono="calafate"
        />
      </div>

      <Tarjeta className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h3 className="font-display text-base font-semibold text-stone-900">Cierre del día</h3>
            <p className="mt-1 text-sm text-stone-600">
              Llegadas, no-shows, salidas y lo cobrado, para repasar antes de cerrar la jornada.
            </p>
          </div>
          <Link href="/panel/cierre-diario" className={botonClases('secundario')}>
            Abrir
          </Link>
        </div>
      </Tarjeta>

      <h2 className="mt-8 mb-3 font-display text-lg font-semibold text-lago-900">Informes</h2>
      {/*
        `columns` y no una grilla: las tarjetas tienen alturas distintas (la
        pregunta y la descripción son de largos desparejos) y una grilla alinea
        por fila, con lo cual cada fila queda tan alta como su tarjeta más alta.
        `columns` equilibra sola.
      */}
      <div className="gap-4 sm:columns-2 xl:columns-3">
        {INFORMES.map((informe) => (
          <Tarjeta key={informe.id} className="mb-4 break-inside-avoid">
            <div className="p-5">
              <h3 className="font-display text-base font-semibold text-stone-900">
                {informe.titulo}
              </h3>
              {/* La pregunta antes que la descripción: quien busca un informe
                  busca una respuesta, no una lista de columnas. */}
              <p className="mt-1 text-sm font-medium text-lago-700">{informe.pregunta}</p>
              <p className="mt-1.5 text-sm text-stone-600">{informe.descripcion}</p>
              {!informe.porMes && (
                <p className="mt-1.5 text-xs text-stone-500">
                  Histórico: no depende del mes elegido.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={rutaDeInforme(informe, mes)}
                  className={botonClases('primario', 'w-full justify-center sm:w-auto')}
                >
                  Ver informe
                </Link>
                <AbrirAparte href={rutaDeInforme(informe, mes)} titulo={informe.titulo} />
              </div>
            </div>
          </Tarjeta>
        ))}
      </div>
    </Pagina>
  )
}
