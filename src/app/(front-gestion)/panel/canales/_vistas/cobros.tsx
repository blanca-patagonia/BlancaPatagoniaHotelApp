import type { DatosCanales } from '../_datos'
import Link from 'next/link'
import { formatoFechaCorta } from '@/lib/fechas'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'
import {
  CAMPO,
  Campo,
  COL_SECUNDARIA,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../../_components/ui'
import { fijarModalidadCobro, registrarTransferenciaCanal } from '../actions'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import {
  ETIQUETAS_MODALIDAD,
  ETIQUETAS_SITUACION,
  MODALIDADES_COBRO,
  type SituacionCobro,
} from '@/lib/domain/canales-cobro'

/** Vista «cobros» de la pantalla de canales. Los datos los carga `_datos.ts`. */
export function VistaCobros({ d }: { d: DatosCanales }) {
  const { cobros, conteoCobros } = d
  return (
    <div className="grid gap-4">
      {/*
            Lo primero que se dice, porque decide qué es esta pantalla.

            Sin ser Connectivity Partner NO existe un aviso de «Booking te pagó»: no
            hay webhook ni push. Prometer una notificación que nunca llega es peor que
            no prometerla, así que esto se presenta por lo que es: una lista para
            mirar, no una alerta que aparece sola.
          */}
      <div className="flex gap-2 rounded-lg bg-lago-50 p-3 text-sm text-stone-700">
        <Icono nombre="ayuda" className="mt-0.5 size-4 shrink-0 text-lago-700" />
        <p>
          <strong>Esto no avisa solo: es una lista para revisar.</strong> Booking no manda
          notificaciones de pago sin la API de partner, así que el sistema compara lo que el canal
          informó contra lo que hay cobrado y muestra lo que no cierra. Conviene mirarla una vez por
          día.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Falta la transferencia"
          valor={String(conteoCobros.faltaTransferencia)}
          detalle="cobró el canal y no llegó"
          icono="divisas"
          tono={conteoCobros.faltaTransferencia > 0 ? 'alerta' : undefined}
        />
        <Kpi
          titulo="Salió sin cobrar"
          valor={String(conteoCobros.salioSinCobrar)}
          detalle="ya se fue y quedó saldo"
          icono="alerta"
          tono={conteoCobros.salioSinCobrar > 0 ? 'peligro' : undefined}
        />
        <Kpi
          titulo="No sabemos quién cobra"
          valor={String(conteoCobros.sinDeterminar)}
          detalle="el informe no lo dijo"
          icono="ayuda"
          tono={conteoCobros.sinDeterminar > 0 ? 'alerta' : undefined}
        />
        <Kpi
          titulo="En riesgo"
          valor={formatearUSD(conteoCobros.enRiesgo)}
          detalle="suma de las tres de al lado"
          icono="reportes"
        />
      </div>

      {conteoCobros.sinDeterminar > 0 && (
        <Tarjeta
          titulo="Fijar quién cobra, de una vez"
          descripcion="Cuando el informe del extranet no trae la columna de forma de pago, todo queda sin determinar."
        >
          <p className="mb-3 text-sm text-stone-600">
            Hay <strong>{conteoCobros.sinDeterminar}</strong>{' '}
            {conteoCobros.sinDeterminar === 1 ? 'reserva' : 'reservas'} sin determinar. Si en esta
            temporada el hotel tiene una sola modalidad activa, se puede fijar de una vez y después
            corregir las excepciones una por una.
          </p>
          <form action={fijarModalidadCobro} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="todas" value="1" />
            <Campo etiqueta="En todas las que no sabemos, cobra">
              <select name="modalidad" defaultValue="hotel" className={CAMPO}>
                {MODALIDADES_COBRO.filter((m) => m !== 'desconocida').map((m) => (
                  <option key={m} value={m}>
                    {ETIQUETAS_MODALIDAD[m]}
                  </option>
                ))}
              </select>
            </Campo>
            <BotonEnvio
              variante="secundario"
              cargando="Guardando…"
              confirmar={`Se va a fijar la forma de cobro en las ${conteoCobros.sinDeterminar} reservas sin determinar. Las que ya tienen una forma asignada no se tocan. ¿Seguir?`}
              extra="w-full sm:w-auto"
            >
              Fijar en todas
            </BotonEnvio>
          </form>
        </Tarjeta>
      )}

      <Tarjeta
        titulo="Lo que hay que resolver"
        descripcion="Reservas del canal cuyo cobro no cierra. Las que están al día y las que todavía no llegaron no aparecen."
      >
        {(() => {
          // Solo las tres situaciones que piden acción, ordenadas por urgencia:
          // primero las que ya se fueron, que es plata que se va caminando.
          const orden: Record<SituacionCobro, number> = {
            salio_sin_cobrar: 0,
            falta_transferencia: 1,
            sin_determinar: 2,
            al_dia: 3,
            pendiente_de_estadia: 4,
          }
          const pendientes = cobros
            .filter((c) => orden[c.situacion] <= 2)
            .sort(
              (a, b) =>
                orden[a.situacion] - orden[b.situacion] || a.checkOut.localeCompare(b.checkOut),
            )

          if (pendientes.length === 0) {
            return (
              <EstadoVacio
                titulo="Todo el cobro del canal cierra"
                descripcion="No hay reservas con saldo sin explicación. Cuando entre un informe nuevo, lo que no cierre aparece acá."
                icono="ok"
              />
            )
          }

          return (
            <Tabla resumen="Reservas del canal con el cobro sin cerrar: huésped, estadía, quién cobra, situación y saldo.">
              <thead>
                <tr className={FILA}>
                  <th className={TH}>Huésped</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Estadía</th>
                  <th className={TH}>Quién cobra</th>
                  <th className={TH}>Situación</th>
                  <th className={TH}>Saldo</th>
                  <th className={TH}>Qué hacer</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((c) => (
                  <tr key={c.entrante.id} className={FILA}>
                    <td className={TD}>
                      <span className="font-medium text-stone-800">
                        {c.entrante.huesped_apellido}
                      </span>
                      <span className="block font-mono text-xs text-stone-500">
                        {c.entrante.reserva?.codigo ?? c.entrante.external_id}
                      </span>
                      {/* En móvil la estadía no tiene columna: se pliega acá. */}
                      <span className="block text-xs text-stone-500 sm:hidden">
                        {formatoFechaCorta(c.entrante.check_in)} →{' '}
                        {formatoFechaCorta(c.entrante.check_out)}
                      </span>
                    </td>
                    <td className={`${TD} ${COL_SECUNDARIA}`}>
                      {formatoFechaCorta(c.entrante.check_in)} →{' '}
                      {formatoFechaCorta(c.entrante.check_out)}
                    </td>
                    <td className={TD}>
                      {/* Cambiar la modalidad de una sola fila, sin salir de acá. */}
                      <form action={fijarModalidadCobro} className="flex items-center gap-1">
                        <input type="hidden" name="entrante_id" value={c.entrante.id} />
                        <select
                          name="modalidad"
                          defaultValue={c.modalidad}
                          aria-label={`Quién cobra la reserva de ${c.entrante.huesped_apellido}`}
                          className="rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                        >
                          {MODALIDADES_COBRO.map((m) => (
                            <option key={m} value={m}>
                              {ETIQUETAS_MODALIDAD[m]}
                            </option>
                          ))}
                        </select>
                        <BotonEnvio variante="fantasma" cargando="…" extra="px-2 py-1 text-xs">
                          Guardar
                        </BotonEnvio>
                      </form>
                    </td>
                    <td className={TD}>
                      {/* Color + texto, nunca solo color. */}
                      <Etiqueta tono={c.situacion === 'salio_sin_cobrar' ? 'peligro' : 'alerta'}>
                        {ETIQUETAS_SITUACION[c.situacion]}
                      </Etiqueta>
                    </td>
                    <td className={TD}>{importe(c.saldo)}</td>
                    <td className={TD}>
                      {c.situacion === 'falta_transferencia' ? (
                        <form
                          action={registrarTransferenciaCanal}
                          className="flex flex-wrap items-end gap-1"
                        >
                          <input type="hidden" name="entrante_id" value={c.entrante.id} />
                          <input
                            name="referencia"
                            required
                            maxLength={60}
                            placeholder="N.º liquidación"
                            aria-label={`Referencia de la liquidación de ${c.entrante.huesped_apellido}`}
                            className="w-32 rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                          />
                          <input
                            name="monto"
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            defaultValue={c.saldo.toFixed(2)}
                            aria-label={`Importe transferido de ${c.entrante.huesped_apellido}`}
                            className="w-24 rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                          />
                          <BotonEnvio cargando="…" extra="px-2 py-1 text-xs">
                            Llegó
                          </BotonEnvio>
                        </form>
                      ) : c.situacion === 'salio_sin_cobrar' ? (
                        <Link
                          href={`/panel/reservas/${c.entrante.reserva_id}`}
                          className="text-sm font-medium text-lago-700 underline"
                        >
                          Cobrar en la ficha
                        </Link>
                      ) : (
                        <span className="text-xs text-stone-500">
                          Decidí quién cobra, a la izquierda
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )
        })()}
      </Tarjeta>
    </div>
  )
}
