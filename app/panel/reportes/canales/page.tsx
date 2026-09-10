import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { mesActual } from '@/lib/fechas'
import { etiquetaMes } from '@/lib/domain/metricas'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import { mesValido } from '@/lib/domain/informes'
import { ETIQUETAS_CANAL, type Canal, type EstadoReserva } from '@/lib/domain/reservas'
import { comisionEfectivaPct, netoDeComision } from '@/lib/domain/canales-costos'
import { costoAdquisicion, totalesDeCanales } from '@/lib/domain/metricas-canal'
import { traerReservas, traerRentabilidadCanal } from '../datos'
import { SelectorDeMes, AvisoIncompleto } from '../_componentes'
import { Icono } from '../../_components/iconos'
import {
  COL_SECUNDARIA,
  Encabezado,
  EstadoVacio,
  FILA,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../../_components/ui'

const ESTADOS_NO_VENDIDOS: EstadoReserva[] = ['cancelada', 'no_show']

/**
 * Rentabilidad por canal.
 *
 * La pregunta del hotel es cuál le deja más plata, así que la tabla se ordena
 * por **neto** y no por bruto: por bruto quedaría primero el que más factura
 * aunque se lleve la mayor comisión.
 */
export default async function InformeCanalesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  await requerirAcceso('reportes')
  const sp = await searchParams
  const mes = mesValido(sp.mes, mesActual())

  const [rentabilidad, reservasRes] = await Promise.all([
    traerRentabilidadCanal(mes),
    traerReservas(),
  ])

  /*
    La vista ya viene agregada por canal, así que NO se pasa por
    `metricasPorCanal` —que espera una fila por reserva y además reordena, con lo
    cual cualquier correspondencia por índice quedaría cruzada—. Se arma la
    métrica de cada canal con los mismos ayudantes puros del dominio.
  */
  const metricasCanal = rentabilidad
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
    .sort((a, b) => b.neto - a.neto)

  const totalesCanal = totalesDeCanales(metricasCanal)

  // Ranking histórico por origen.
  const porCanal = new Map<string, { cantidad: number; monto: number }>()
  for (const r of reservasRes.filas) {
    const c = porCanal.get(r.canal) ?? { cantidad: 0, monto: 0 }
    c.cantidad += 1
    if (!ESTADOS_NO_VENDIDOS.includes(r.estado)) c.monto += Number(r.total)
    porCanal.set(r.canal, c)
  }
  const canales = [...porCanal.entries()].sort((a, b) => b[1].cantidad - a[1].cantidad)

  return (
    <Pagina>
      <Link
        href="/panel/reportes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reportes
      </Link>

      <Encabezado
        titulo="Rentabilidad por canal"
        descripcion={`Qué deja cada canal en ${etiquetaMes(mes)}, después de su comisión.`}
        icono="canales"
      />

      <AvisoIncompleto incompleto={reservasRes.truncado} />

      <SelectorDeMes base="/panel/reportes/canales" mes={mes} />

      <Tarjeta titulo={`Del mes · ${etiquetaMes(mes)}`}>
        {/*
          La advertencia que evita el error más caro de esta pantalla.

          `tarifa_tipo = 'neto'` es un TIPO DE TARIFA —la de agencia, contra la
          rack de mostrador— y NO «importe al que ya se le descontó la comisión».
          Sin decirlo acá, alguien resta la comisión de un total que creía ya
          neto y el número queda más bajo sin que nadie lo note.
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
          <p className="px-5 py-4 text-sm text-stone-600">No hubo salidas en {etiquetaMes(mes)}.</p>
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
                              `—` y NUNCA `USD 0`. Para directo y web el costo no
                              es cero —hay Google Ads y tiempo de mostrador— pero
                              el sistema no los conoce, y eso es distinto de que
                              no existan. Mostrar cero haría concluir que el
                              directo es gratis, y llevaría a bajar la inversión
                              en los canales pagos sin saber qué cuesta el propio.
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

      <Tarjeta
        titulo="Ranking de canales"
        descripcion="Reservas históricas por origen. No depende del mes elegido."
        className="mt-6"
      >
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
                  <td className={`${TD} tabular text-right text-stone-800`}>{importe(v.monto)}</td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
    </Pagina>
  )
}
