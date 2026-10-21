import type { DatosCanales } from '../_datos'
import { MONEDAS_EXTRANJERAS } from '@/lib/domain/divisas'
import { formatoFechaCorta } from '@/lib/fechas'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'
import { SelectorMes } from '../../_components/selector-mes'
import {
  CAMPO,
  Campo,
  COL_SECUNDARIA,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Mensaje,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../../_components/ui'
import { conciliarCargo, registrarFacturaComision } from '../cobros.actions'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import {
  ESTADOS_CONCILIACION,
  ETIQUETAS_CONCEPTO,
  ETIQUETAS_CONCILIACION,
  ETIQUETAS_ORIGEN,
  type ConceptoCargo,
  type EstadoConciliacion,
  type OrigenCargo,
} from '@/lib/domain/canales-costos'

/** Vista «costos» de la pantalla de canales. Los datos los carga `_datos.ts`. */
export function VistaCostos({ d }: { d: DatosCanales }) {
  const {
    cargos,
    conciliacion,
    facturado,
    mesConciliacion,
    puedeConciliarCargos,
    sinComision,
    sinConvertir,
  } = d
  return (
    <div className="grid gap-4">
      <Tarjeta
        titulo="Conciliación de la comisión"
        descripcion="Lo que el canal informó por reserva, contra lo que después facturó, mes a mes."
      >
        <form method="get" action="/panel/canales" className="mb-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="vista" value="costos" />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Mes a conciliar</span>
            <SelectorMes name="mes" defaultValue={mesConciliacion} ariaLabel="Mes a conciliar" />
          </label>
          <button className={botonClases('secundario', 'px-3 py-1.5 text-sm')}>Ver</button>
        </form>

        {/*
              La advertencia que evita el error más caro de esta pantalla. `tarifa_tipo
              = 'neto'` es un TIPO DE TARIFA (la de agencia, contra la rack de
              mostrador) y no «importe al que ya se le descontó la comisión». Sin
              decirlo acá, alguien resta la comisión de un total que creía ya neto y el
              número queda mal sin que nadie lo note.
            */}
        <div className="mb-4 flex gap-2 rounded-lg bg-lago-50 p-3 text-sm text-stone-700">
          <Icono nombre="ayuda" className="mt-0.5 size-4 shrink-0 text-lago-700" />
          <p>
            <strong>Neto de comisión = total − comisión.</strong> El total de la reserva es lo que
            paga el huésped; la comisión es un gasto del hotel. Que la reserva vaya a tarifa{' '}
            <em>neto</em> significa que se cobró a precio de agencia, <strong>no</strong> que ya
            tenga la comisión descontada.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi
            titulo="Devengado"
            valor={formatearUSD(conciliacion.devengado)}
            detalle="según el informe de reservas"
            icono="reportes"
          />
          <Kpi
            titulo="Facturado por el canal"
            valor={facturado > 0 ? formatearUSD(conciliacion.facturado) : '—'}
            detalle={
              facturado > 0 ? 'según la factura de comisión' : 'todavía no se cargó ninguna factura'
            }
            icono="divisas"
          />
          <Kpi
            titulo="Diferencia"
            valor={facturado > 0 ? formatearUSD(Math.abs(conciliacion.diferencia)) : '—'}
            detalle={
              facturado === 0
                ? 'hace falta la factura para comparar'
                : conciliacion.cierra
                  ? 'cierra'
                  : 'revisar antes de pagar'
            }
            icono={conciliacion.cierra || facturado === 0 ? 'ok' : 'alerta'}
            tono={facturado > 0 && !conciliacion.cierra ? 'peligro' : undefined}
          />
        </div>

        {facturado > 0 && !conciliacion.cierra && (
          <div className="mt-4">
            <Mensaje tono="error">{conciliacion.detalle}</Mensaje>
          </div>
        )}

        {sinConvertir > 0 && (
          <div className="mt-4 flex gap-2 rounded-lg bg-calafate-50 p-3 text-sm text-stone-700">
            <Icono nombre="alerta" className="mt-0.5 size-4 shrink-0 text-calafate-700" />
            <p>
              {sinConvertir === 1
                ? 'Un cargo de comisión no tiene cotización a dólares'
                : `${sinConvertir} cargos de comisión no tienen cotización a dólares`}{' '}
              y no están sumados arriba: la comparación no es definitiva hasta cargar la cotización
              del día en que se imputaron.
            </p>
          </div>
        )}

        {sinComision > 0 && (
          /*
                No se presenta el devengado como definitivo si hay reservas sin
                comisión informada: el feed iCal nunca la trae, así que este caso es
                normal y hay que decirlo. Contarlas aparte es la diferencia entre «el
                devengado es esto» y «es al menos esto».
              */
          <div className="mt-4 flex gap-2 rounded-lg bg-calafate-50 p-3 text-sm text-stone-700">
            <Icono nombre="alerta" className="mt-0.5 size-4 shrink-0 text-calafate-700" />
            <p>
              Hay <strong>{sinComision}</strong>{' '}
              {sinComision === 1 ? 'reserva entrante' : 'reservas entrantes'} sin comisión
              informada, así que el devengado es <strong>al menos</strong> ese importe y no el
              total. El feed iCal no informa comisión: para tenerla hay que subir el informe de
              reservas del extranet.
            </p>
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Cargar la factura de comisión"
        descripcion="La que Booking emite por mes, desde Finanzas → Facturas del extranet."
      >
        <form action={registrarFacturaComision} className="grid gap-3 sm:grid-cols-6">
          <Campo etiqueta="N.º de comprobante">
            <input
              name="comprobante"
              required
              maxLength={60}
              className={CAMPO}
              placeholder="1234567890"
            />
          </Campo>
          <Campo etiqueta="Mes que factura">
            <SelectorMes
              name="periodo"
              id="periodo"
              required
              ariaLabel="Mes que factura"
              className={CAMPO}
            />
          </Campo>
          {/* Booking no factura en dólares: emite en euros o en pesos según el
                  contrato. Sin este campo el importe entraba como USD al libro
                  mayor (auditoría 2026-09, P1-3). */}
          <Campo etiqueta="Moneda" ayuda="La de la factura del canal.">
            <select name="moneda" defaultValue="USD" className={CAMPO}>
              <option value="USD">USD</option>
              {MONEDAS_EXTRANJERAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Importe">
            <input name="monto" type="number" step="0.01" min="0.01" required className={CAMPO} />
          </Campo>
          <Campo etiqueta="Vence el">
            <input id="vencimiento" name="vencimiento" type="date" className={CAMPO} />
          </Campo>
          <div className="flex items-end">
            <BotonEnvio cargando="Registrando…" extra="w-full sm:w-auto">
              Registrar
            </BotonEnvio>
          </div>
        </form>
        <p className="mt-3 text-xs text-stone-500">
          Registrar la factura crea la deuda con el proveedor —con su vencimiento y su antigüedad de
          saldos, en el módulo Proveedores— y la línea que se compara contra lo devengado.{' '}
          <strong>No marca nada como conciliado</strong>: decidir si una diferencia es aceptable es
          una decisión, no un efecto de cargar un número.
        </p>
      </Tarjeta>

      <Tarjeta
        titulo="Cargos del canal"
        descripcion="Cada costo imputado a la venta que lo generó."
      >
        {cargos.length === 0 ? (
          <EstadoVacio
            titulo="Todavía no hay cargos"
            descripcion="Los cargos se devengan al subir el informe de reservas del extranet: de ahí sale la comisión de cada reserva."
            icono="reportes"
          />
        ) : (
          <Tabla resumen="Cargos del canal: concepto, reserva, origen del dato, fecha de imputación, importe y estado de conciliación.">
            <thead>
              <tr className={FILA}>
                <th className={TH}>Concepto</th>
                <th className={TH}>Reserva</th>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Origen</th>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Imputado</th>
                <th className={TH}>Importe</th>
                <th className={TH}>Estado</th>
                {puedeConciliarCargos && <th className={TH}>Cerrar la revisión</th>}
              </tr>
            </thead>
            <tbody>
              {cargos.map((c) => (
                <tr key={c.id} className={FILA}>
                  <td className={TD}>
                    <span className="font-medium text-stone-800">
                      {ETIQUETAS_CONCEPTO[c.concepto as ConceptoCargo] ?? c.concepto}
                    </span>
                    {/* En móvil el origen no tiene columna: se pliega acá. */}
                    <span className="block text-xs text-stone-500 sm:hidden">
                      {ETIQUETAS_ORIGEN[c.origen as OrigenCargo] ?? c.origen}
                    </span>
                  </td>
                  <td className={TD}>
                    {c.reserva?.codigo ? (
                      <span className="font-mono text-xs">{c.reserva.codigo}</span>
                    ) : c.entrante ? (
                      <span className="text-stone-700">
                        {c.entrante.huesped_apellido}
                        <span className="block font-mono text-xs text-stone-500">
                          {c.entrante.external_id}
                        </span>
                      </span>
                    ) : (
                      /*
                              El caso que justifica que `canal_reserva_id` sea nullable:
                              una línea de factura que no se atribuye a ninguna reserva
                              significa que el canal cobró algo que no reconocemos. Se
                              dice, no se esconde.
                            */
                      <span className="text-calafate-700">
                        Sin reserva atribuida
                        <span className="block text-xs text-stone-500">
                          el canal cobró algo que no reconocemos
                        </span>
                      </span>
                    )}
                  </td>
                  <td className={`${TD} ${COL_SECUNDARIA}`}>
                    {ETIQUETAS_ORIGEN[c.origen as OrigenCargo] ?? c.origen}
                  </td>
                  <td className={`${TD} ${COL_SECUNDARIA}`}>
                    {c.imputado_el ? formatoFechaCorta(c.imputado_el) : '—'}
                  </td>
                  <td className={TD}>
                    {importe(Number(c.monto))}
                    {c.moneda !== 'USD' && (
                      <span className="block text-xs text-stone-500">{c.moneda}</span>
                    )}
                  </td>
                  <td className={TD}>
                    {/* Color + texto: nunca solo color (accesibilidad). */}
                    <Etiqueta
                      tono={
                        c.estado_conciliacion === 'en_disputa'
                          ? 'peligro'
                          : c.estado_conciliacion === 'conciliado'
                            ? 'exito'
                            : 'neutro'
                      }
                    >
                      {ETIQUETAS_CONCILIACION[c.estado_conciliacion as EstadoConciliacion] ??
                        c.estado_conciliacion}
                    </Etiqueta>
                    {c.nota_conciliacion && (
                      <span className="mt-1 block text-xs text-stone-500">
                        {c.nota_conciliacion}
                      </span>
                    )}
                  </td>
                  {/*
                          Cerrar la revisión (P1-4).

                          Hasta la migración 0079 la columna de al lado decía
                          «Devengado» en todas las filas para siempre: el estado
                          existía y nada lo escribía, así que cada mes había que
                          revisar de nuevo lo ya revisado.

                          Solo lo ve gerencia: aceptar una diferencia es aceptar un
                          costo y disputarla es abrir un reclamo.
                        */}
                  {puedeConciliarCargos && (
                    <td className={TD}>
                      <form action={conciliarCargo} className="flex flex-wrap items-end gap-1.5">
                        <input type="hidden" name="cargo_id" value={c.id} />
                        <label className="flex flex-col gap-1 text-xs">
                          <span className="text-stone-500">Estado</span>
                          <select
                            name="estado"
                            defaultValue={
                              c.estado_conciliacion === 'devengado' ? 'conciliado' : 'devengado'
                            }
                            className={CAMPO}
                          >
                            {ESTADOS_CONCILIACION.filter((e) => e !== c.estado_conciliacion).map(
                              (e) => (
                                <option key={e} value={e}>
                                  {ETIQUETAS_CONCILIACION[e]}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs">
                          <span className="text-stone-500">Motivo</span>
                          <input
                            name="nota"
                            maxLength={500}
                            placeholder="Motivo (si disputás)"
                            className={`${CAMPO} w-44`}
                          />
                        </label>
                        <BotonEnvio variante="secundario" cargando="Guardando…">
                          Guardar
                        </BotonEnvio>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
    </div>
  )
}
