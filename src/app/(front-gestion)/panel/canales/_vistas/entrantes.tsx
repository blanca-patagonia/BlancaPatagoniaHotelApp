import type { DatosCanales } from '../_datos'
import Link from 'next/link'
import { formatoFechaCorta } from '@/lib/fechas'
import { construirQuery } from '@/lib/listados'
import { BotonEnvio } from '../../_components/boton-envio'
import {
  BarraHerramientas,
  Chip,
  EstadoVacio,
  Etiqueta,
  FILA,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../../_components/ui'
import { ignorarEntrante, importarUna, reintentarEntrante } from '../actions'
import { importe } from '@/lib/domain/moneda'
import { ESTADOS_ENTRANTE, ETIQUETAS_ESTADO, TONO_ESTADO } from '../_compartido'

/** Vista «entrantes» de la pantalla de canales. Los datos los carga `_datos.ts`. */
export function VistaEntrantes({ d }: { d: DatosCanales }) {
  const { conteo, entrantes, estado, hoy, vigentes } = d
  return (
    <>
      <BarraHerramientas>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            href={`/panel/canales${construirQuery(vigentes, { estado: undefined })}`}
            activo={!estado}
          >
            Todas
          </Chip>
          {ESTADOS_ENTRANTE.map((e) => (
            <Chip
              key={e}
              href={`/panel/canales${construirQuery(vigentes, { estado: e })}`}
              activo={estado === e}
            >
              {ETIQUETAS_ESTADO[e]} ({conteo.get(e) ?? 0})
            </Chip>
          ))}
        </div>
      </BarraHerramientas>

      <Tarjeta className="overflow-hidden">
        {entrantes.length === 0 ? (
          <EstadoVacio
            titulo={
              estado
                ? `No hay reservas «${ETIQUETAS_ESTADO[estado]}»`
                : 'Todavía no llegó ninguna reserva'
            }
            descripcion={
              estado
                ? 'Probá con otro estado o quitá el filtro.'
                : 'Subí el informe del extranet, o configurá los feeds iCal para que se sincronicen solas.'
            }
            icono="canales"
          />
        ) : (
          <div className="overflow-x-auto">
            <Tabla resumen="Reservas llegadas de canales externos, con su estado de importación">
              <thead>
                <tr>
                  <th className={TH}>Huésped</th>
                  <th className={TH}>Estadía</th>
                  <th className={TH}>Tipo pedido</th>
                  <th className={`${TH} text-right`}>Canal informa</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {entrantes.map((e) => {
                  const llegaHoy = e.check_in === hoy
                  const saleHoy = e.check_out === hoy
                  const enCurso = e.check_in <= hoy && e.check_out > hoy

                  return (
                    <tr key={e.id} className={FILA}>
                      <td className={TD}>
                        <span className="font-medium text-stone-800">
                          {e.huesped_apellido}
                          {e.huesped_nombre ? `, ${e.huesped_nombre}` : ''}
                        </span>
                        <span className="block text-xs text-stone-500">
                          {e.canal} · {e.external_id}
                          {e.huesped_pais ? ` · ${e.huesped_pais}` : ''}
                        </span>
                        {e.huesped_email && (
                          <span className="block text-xs text-stone-500">{e.huesped_email}</span>
                        )}
                      </td>

                      <td className={`${TD} text-stone-600`}>
                        <span className="tabular">
                          {formatoFechaCorta(e.check_in)} → {formatoFechaCorta(e.check_out)}
                        </span>
                        <span className="block text-xs text-stone-500">
                          {e.huespedes} huésped(es)
                        </span>
                        {/* Llegadas, salidas y estancias marcadas con texto,
                                no sólo con color. */}
                        {llegaHoy && <Etiqueta tono="exito">Llega hoy</Etiqueta>}
                        {saleHoy && <Etiqueta tono="alerta">Sale hoy</Etiqueta>}
                        {enCurso && !llegaHoy && <Etiqueta tono="lago">En curso</Etiqueta>}
                      </td>

                      <td className={`${TD} text-stone-600`}>
                        <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">
                          {e.tipo_unidad_codigo}
                        </code>
                      </td>

                      <td className={`${TD} tabular text-right text-stone-600`}>
                        {Number(e.importe_canal ?? 0) > 0 ? (
                          <>
                            {e.moneda_canal} {importe(Number(e.importe_canal))}
                            {e.comision != null && (
                              <span className="block text-xs text-stone-500">
                                comisión {importe(Number(e.comision))}
                              </span>
                            )}
                          </>
                        ) : (
                          /* No se muestra «0» como si fuera un precio: el iCal
                                 no informa importes y un cero ahí se leería como
                                 «reserva gratis». */
                          <span className="text-xs text-stone-400">no informa</span>
                        )}
                      </td>

                      <td className={TD}>
                        <Etiqueta tono={TONO_ESTADO[e.estado]}>
                          {ETIQUETAS_ESTADO[e.estado]}
                        </Etiqueta>
                        {e.operacion === 'cancelada' && (
                          <span className="mt-1 block text-xs font-medium text-red-700">
                            el canal la canceló
                          </span>
                        )}
                        {e.reserva?.codigo && (
                          <Link
                            href={`/panel/reservas/${e.reserva_id}`}
                            className="mt-1 block text-xs font-medium text-lago-700 hover:underline"
                          >
                            {e.reserva.codigo}
                          </Link>
                        )}
                        {e.reserva?.agencia?.nombre && (
                          <span className="mt-1 inline-block">
                            <Etiqueta tono="neutro">{e.reserva.agencia.nombre}</Etiqueta>
                          </span>
                        )}
                        {e.motivo && (
                          <span className="mt-1 block max-w-xs text-xs text-stone-600">
                            {e.motivo}
                          </span>
                        )}
                        {/*
                              El canal cambió algo DESPUÉS de importarla (0088).

                              Va en rojo y con el detalle a la vista porque es lo
                              más caro del módulo: la reserva del hotel sigue con
                              los datos viejos y no hay ningún otro síntoma hasta
                              que el huésped se presenta. El sistema no la corrige
                              solo, así que este texto es lo único que dispara la
                              corrección.
                            */}
                        {e.divergencia_desde && e.divergencia && (
                          <span className="mt-1 block max-w-xs rounded-lg bg-red-50 px-2 py-1 text-xs text-red-800 ring-1 ring-red-200">
                            <strong>El canal cambió esta reserva.</strong> {e.divergencia}.
                            Corregila a mano en la ficha: el sistema no la mueve solo.
                          </span>
                        )}
                        {e.notas && (
                          <span className="mt-1 block max-w-xs text-xs text-stone-500 italic">
                            «{e.notas}»
                          </span>
                        )}
                      </td>

                      <td className={TD}>
                        <div className="flex flex-col gap-1.5">
                          {(e.estado === 'pendiente' || e.estado === 'error') &&
                            e.operacion !== 'cancelada' && (
                              <form action={importarUna}>
                                <input type="hidden" name="entrante_id" value={e.id} />
                                <BotonEnvio cargando="Importando…" extra="w-full">
                                  Importar
                                </BotonEnvio>
                              </form>
                            )}

                          {e.estado === 'ignorada' && (
                            <form action={reintentarEntrante}>
                              <input type="hidden" name="entrante_id" value={e.id} />
                              <BotonEnvio
                                variante="secundario"
                                cargando="Reactivando…"
                                extra="w-full"
                              >
                                Reactivar
                              </BotonEnvio>
                            </form>
                          )}

                          {e.estado !== 'importada' && e.estado !== 'ignorada' && (
                            <form action={ignorarEntrante}>
                              <input type="hidden" name="entrante_id" value={e.id} />
                              <BotonEnvio
                                variante="fantasma"
                                cargando="Descartando…"
                                extra="w-full"
                                confirmar={`¿Descartar la reserva de ${e.huesped_apellido}? No se va a crear en el sistema.`}
                              >
                                Descartar
                              </BotonEnvio>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabla>
          </div>
        )}
      </Tarjeta>
    </>
  )
}
