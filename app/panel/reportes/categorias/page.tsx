import { requerirAcceso } from '@/lib/auth/session'
import { mesActual } from '@/lib/fechas'
import { etiquetaMes } from '@/lib/domain/metricas'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import { mesValido } from '@/lib/domain/informes'
import {
  ventaPorTipo,
  totalesDeVenta,
  agruparPorCategoria,
  type VentaDeTipo,
} from '@/lib/domain/metricas-categoria'
import { ETIQUETAS_FILTRO, type FiltroCategoria } from '@/lib/domain/catalogo'
import { traerEstadiasPorTipo, traerTiposConInventario } from '../datos'
import { SelectorDeMes, AvisoIncompleto } from '../_componentes'
import {
  COL_SECUNDARIA,
  Encabezado,
  EstadoVacio,
  FILA,
  Kpi,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../../_components/ui'

/**
 * Venta por categoría.
 *
 * Pedido del hotel: «informe de venta x categoría». Es la columna «Tipo Hab» de
 * WinPAX —STD, SUP, TRI, CA2…— y la pregunta de fondo es cuál de los tipos deja
 * más plata, la misma que ya se contesta por canal.
 *
 * La cuenta vive entera en `lib/domain/metricas-categoria.ts`, que reusa
 * `metricasDeMes`: así ocupación, ADR y RevPAR se definen una sola vez en todo
 * el sistema y este informe no puede divergir del de ocupación.
 */
export default async function InformeCategoriasPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  await requerirAcceso('reportes')
  const sp = await searchParams
  const mes = mesValido(sp.mes, mesActual())

  const [estadias, tipos] = await Promise.all([
    traerEstadiasPorTipo(),
    traerTiposConInventario(),
  ])

  const filas = ventaPorTipo(estadias.filas, tipos.filas, mes)
  const totales = totalesDeVenta(filas)
  const grupos = agruparPorCategoria(filas)
  const huboVenta = totales.nochesVendidas > 0

  return (
    <Pagina>
      <Encabezado
        titulo="Venta por categoría"
        descripcion={`Qué vendió cada tipo de alojamiento en ${etiquetaMes(mes)}.`}
        icono="reportes"
      />

      <AvisoIncompleto incompleto={estadias.truncado || tipos.truncado} />

      <SelectorDeMes base="/panel/reportes/categorias" mes={mes} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Ingreso del mes"
          valor={formatearUSD(totales.ingreso)}
          detalle="alojamiento, sin consumos"
          icono="reportes"
        />
        <Kpi
          titulo="Noches vendidas"
          valor={totales.nochesVendidas.toLocaleString('es-AR')}
          detalle={`de ${totales.nochesDisponibles.toLocaleString('es-AR')} disponibles`}
          icono="ocupacion"
        />
        <Kpi
          titulo="ADR del hotel"
          valor={totales.adr === null ? '—' : formatearUSD(totales.adr)}
          detalle="ingreso / noches vendidas"
          icono="reportes"
        />
        <Kpi
          titulo="Ocupación"
          valor={totales.ocupacionPct === null ? '—' : `${totales.ocupacionPct}%`}
          detalle={`RevPAR ${totales.revpar === null ? '—' : formatearUSD(totales.revpar)}`}
          icono="ok"
          tono="exito"
        />
      </div>

      {filas.length === 0 ? (
        <Tarjeta className="mt-6">
          <EstadoVacio
            titulo="Todavía no hay tipos de alojamiento cargados"
            descripcion="El informe se arma con los tipos del catálogo y las estadías vendidas."
            icono="reportes"
          />
        </Tarjeta>
      ) : (
        <>
          {!huboVenta && (
            /* Se muestra la tabla igual, en ceros: un mes sin ventas es un dato,
               y esconder la tabla haría parecer que el informe no funciona. */
            <p className="mt-6 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
              No hubo noches vendidas en {etiquetaMes(mes)}.
            </p>
          )}

          {grupos.map((grupo) => (
            <Tarjeta
              key={grupo.categoria || 'sin-categoria'}
              titulo={
                ETIQUETAS_FILTRO[grupo.categoria as FiltroCategoria] ??
                (grupo.categoria || 'Sin categoría')
              }
              descripcion={`${grupo.filas.length} ${grupo.filas.length === 1 ? 'tipo' : 'tipos'} · ordenados por ingreso`}
              className="mt-6"
            >
              <div className="overflow-x-auto">
                <Tabla resumen="Venta por tipo de alojamiento: noches, ingreso, ADR, ocupación y participación.">
                  <thead>
                    <tr className={FILA}>
                      <th className={TH}>Tipo</th>
                      <th className={`${TH} ${COL_SECUNDARIA} text-right`}>Unidades</th>
                      <th className={`${TH} text-right`}>Noches</th>
                      <th className={`${TH} text-right`}>Ingreso</th>
                      <th className={`${TH} text-right`}>ADR</th>
                      <th className={`${TH} ${COL_SECUNDARIA} text-right`}>Ocupación</th>
                      <th className={`${TH} text-right`}>% del ingreso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.filas.map((f) => (
                      <FilaDeTipo key={f.tipoId} fila={f} />
                    ))}
                  </tbody>
                </Tabla>
              </div>
            </Tarjeta>
          ))}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-stone-200 bg-white px-5 py-3 text-sm shadow-sm">
            <span className="text-stone-600">
              Total del mes{' '}
              <strong className="text-stone-800">{formatearUSD(totales.ingreso)}</strong>
            </span>
            <span className="text-stone-600">
              Noches{' '}
              <strong className="text-stone-800">
                {totales.nochesVendidas.toLocaleString('es-AR')}
              </strong>
            </span>
            <span className="text-stone-600">
              ADR{' '}
              <strong className="text-stone-800">
                {totales.adr === null ? '—' : formatearUSD(totales.adr)}
              </strong>
            </span>
          </div>

          {/*
            La aclaración que evita leer mal la columna de ingreso: es
            alojamiento y nada más. El desayuno suelto, el frigobar y las
            excursiones son consumos y viven en la cuenta del huésped, así que
            este total NO es lo que facturó el hotel.
          */}
          <p className="mt-3 text-xs text-stone-500">
            El ingreso es de <strong>alojamiento</strong> y está imputado noche por noche al mes
            en que se durmió: no incluye consumos ni depende de cuándo se cobró. El ADR del total
            es el ingreso sobre las noches vendidas, no el promedio de los ADR de cada tipo.
          </p>
        </>
      )}
    </Pagina>
  )
}

/** Una fila de la tabla. Se separa porque tiene varios casos de «no hay dato». */
function FilaDeTipo({ fila }: { fila: VentaDeTipo }) {
  return (
    <tr className={FILA}>
      <td className={TD}>
        <span className="font-medium text-stone-800">{fila.codigo}</span>
        <span className="block text-xs text-stone-500">{fila.nombre}</span>
        {/* En pantalla chica se pliegan bajo el nombre las dos columnas que se
            esconden, en vez de perderlas. */}
        <span className="block text-xs text-stone-500 sm:hidden">
          {fila.unidades} {fila.unidades === 1 ? 'unidad' : 'unidades'}
          {fila.ocupacionPct !== null && ` · ${fila.ocupacionPct}% ocupación`}
        </span>
      </td>
      <td className={`${TD} ${COL_SECUNDARIA} tabular text-right text-stone-700`}>
        {fila.unidades}
      </td>
      <td className={`${TD} tabular text-right text-stone-800`}>
        {fila.nochesVendidas.toLocaleString('es-AR')}
      </td>
      <td className={`${TD} tabular text-right font-medium text-stone-800`}>
        {importe(fila.ingreso)}
      </td>
      <td className={`${TD} tabular text-right text-stone-800`}>
        {/*
          Sin noches vendidas no hay tarifa media. `USD 0` diría que se vendió a
          cero, que es una afirmación distinta y falsa.
        */}
        {fila.adr === null ? <span className="text-stone-400">—</span> : importe(fila.adr)}
      </td>
      <td className={`${TD} ${COL_SECUNDARIA} tabular text-right text-stone-700`}>
        {fila.ocupacionPct === null ? (
          /*
            Un tipo sin unidades activas no está al 0 %: no tiene denominador.
            Mostrar 0 % haría ver como vacío un tipo que quizá se vendió entero
            antes de darlo de baja.
          */
          <span className="text-stone-400" title="Este tipo ya no tiene unidades activas">
            —
          </span>
        ) : (
          `${fila.ocupacionPct}%`
        )}
      </td>
      <td className={`${TD} tabular text-right text-stone-700`}>
        {fila.participacionPct === null ? (
          <span className="text-stone-400">—</span>
        ) : (
          `${fila.participacionPct.toFixed(1)}%`
        )}
      </td>
    </tr>
  )
}
