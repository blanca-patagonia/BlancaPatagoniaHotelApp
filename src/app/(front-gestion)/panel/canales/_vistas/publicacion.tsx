import type { DatosCanales } from '../_datos'
import { formatoFechaCorta, horaHotel, sumarDias, fechaDelHotel } from '@/lib/fechas'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'
import {
  CAMPO,
  Campo,
  COL_SECUNDARIA,
  EstadoVacio,
  Etiqueta,
  FILA,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../../_components/ui'
import {
  borrarRestriccionCanal,
  guardarMapeoCanal,
  guardarRestriccionCanal,
  publicarAhora,
} from '../actions'

/** Vista «publicacion» de la pantalla de canales. Los datos los carga `_datos.ts`. */
export function VistaPublicacion({ d }: { d: DatosCanales }) {
  const {
    capacidades,
    mapeoPorTipo,
    puedeConciliarCargos,
    restricciones,
    tiposUnidad,
    ultimaSalida,
  } = d
  return (
    <div className="space-y-4">
      {/*
            La advertencia va PRIMERO y no al final.

            Alguien que entra a una pantalla titulada «Publicación al canal»
            asume, con toda razón, que el sistema le está informando a Booking qué
            queda libre. Hoy no lo hace: los dos caminos disponibles sin ser
            Connectivity Partner son de solo lectura. Que eso se lea después de la
            tabla sería dejar que se forme la conclusión equivocada primero.
          */}
      {!capacidades.publicaDisponibilidad && (
        <div className="flex items-start gap-3 rounded-xl bg-lenga-50 px-4 py-3 ring-1 ring-lenga-200">
          <span className="mt-0.5 shrink-0 text-lenga-700">
            <Icono nombre="alerta" tam={18} />
          </span>
          <div className="text-sm text-lenga-900">
            <p className="font-semibold">
              El proveedor configurado NO puede publicarle disponibilidad al canal.
            </p>
            <p className="mt-1 text-stone-700">
              Lo de acá abajo se calcula y se registra, pero no sale a ningún lado. Sirve para dos
              cosas concretas: que la importación resuelva bien los tipos aunque Booking les diga de
              otra forma, y que el día que el hotel contrate un <strong>channel manager</strong> lo
              único que falte sea enchufarlo. La sincronización en las dos direcciones es una
              contratación, no una decisión técnica.
            </p>
          </div>
        </div>
      )}

      <Tarjeta
        titulo="Cómo llama el canal a cada tipo de unidad"
        descripcion="Sirve para los dos sentidos: resolver una reserva entrante y armar lo que se publica."
      >
        <p className="mb-4 text-sm text-stone-600">
          Booking puede llamar «DBL-LAGO» a lo que el sistema llama «DOBLE_VISTA». Hasta ahora había
          que renombrar el tipo del hotel para que la importación funcionara; con esto se anota la
          equivalencia una vez.
        </p>

        {tiposUnidad.length === 0 ? (
          <EstadoVacio
            titulo="No hay tipos de unidad activos"
            descripcion="Cargá los tipos de unidad antes de mapearlos a un canal."
            icono="ocupacion"
          />
        ) : (
          <div className="overflow-x-auto">
            <Tabla resumen="Tipos de unidad y su equivalencia en el canal, con el tope de cupo y las restricciones que se publican.">
              <thead>
                <tr className={FILA}>
                  <th className={TH}>Tipo del hotel</th>
                  <th className={TH}>Código en el canal</th>
                  <th className={TH}>Tope de cupo</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Mín. noches</th>
                  <th className={TH}>Cerrado</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {tiposUnidad.map((t) => {
                  const m = mapeoPorTipo.get(t.id)
                  return (
                    // El id es el ancla de `guardarMapeoCanal`: sin él, guardar
                    // esta fila devuelve al principio de una tabla de 23 y el
                    // aviso de "Guardado" queda lejos de lo que se editó.
                    <tr key={t.id} id={`tipo-${t.id}`} className={FILA}>
                      <td className={TD}>
                        <span className="font-medium text-stone-800">{t.nombre}</span>
                        <span className="block font-mono text-xs text-stone-500">{t.codigo}</span>
                      </td>
                      <td className={TD} colSpan={5}>
                        <form action={guardarMapeoCanal} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="tipo_unidad_id" value={t.id} />
                          <Campo etiqueta="Código en el canal">
                            <input
                              name="codigo_canal"
                              defaultValue={m?.codigo_canal ?? t.codigo}
                              maxLength={60}
                              required
                              className={`${CAMPO} w-40`}
                            />
                          </Campo>
                          <Campo etiqueta="Tope de cupo" ayuda="Vacío = todas las unidades.">
                            <input
                              name="tope_cupo"
                              type="number"
                              min="0"
                              defaultValue={m?.tope_cupo ?? ''}
                              className={`${CAMPO} w-24`}
                            />
                          </Campo>
                          <Campo etiqueta="Mín. noches">
                            <input
                              name="minimo_noches"
                              type="number"
                              min="1"
                              defaultValue={m?.minimo_noches ?? ''}
                              className={`${CAMPO} w-24`}
                            />
                          </Campo>
                          <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
                            <input
                              type="checkbox"
                              name="cerrado"
                              defaultChecked={m?.cerrado ?? false}
                              className="size-4"
                            />
                            Cerrado
                          </label>
                          <BotonEnvio variante="secundario" cargando="Guardando…">
                            Guardar
                          </BotonEnvio>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabla>
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Restricciones por fecha"
        descripcion="Un mínimo de noches o un cierre que vale sólo para unos días, sin tocar el resto del año."
      >
        <div className="mb-4 space-y-2 text-sm text-stone-600">
          <p>
            Las restricciones de la tabla de arriba valen <strong>siempre</strong>. Éstas valen para
            un tramo de fechas: «el fin de semana largo pide 3 noches», «esas dos semanas las guardo
            para el grupo que reservó por teléfono», «no acepto llegadas el 24».
          </p>
          <p>
            <strong>El «hasta» queda afuera.</strong> Del 9 al 13 alcanza al 9, 10, 11 y 12: es la
            misma forma de contar que las temporadas y las estadías.
          </p>
          <p>
            <strong>Sin llegadas</strong> no cierra el día: deja que alguien pase esa noche, pero no
            que empiece ahí. Es lo que evita que un fin de semana largo se parta al medio.{' '}
            <strong>Sin salidas</strong> es lo mismo del otro lado.
          </p>
        </div>

        {puedeConciliarCargos ? (
          <form
            action={guardarRestriccionCanal}
            className="mb-5 flex flex-wrap items-end gap-2 rounded-xl bg-stone-50 p-4 ring-1 ring-stone-200"
          >
            <Campo etiqueta="Desde">
              <input name="desde" type="date" required className={`${CAMPO} w-40`} />
            </Campo>
            <Campo etiqueta="Hasta (excluido)">
              <input name="hasta" type="date" required className={`${CAMPO} w-40`} />
            </Campo>
            <Campo etiqueta="Tipo de unidad" ayuda="Vacío = todo el hotel.">
              <select name="tipo_unidad_id" className={`${CAMPO} w-48`}>
                <option value="">Todos los tipos</option>
                {tiposUnidad.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Mín. noches">
              <input name="minimo_noches" type="number" min="1" className={`${CAMPO} w-24`} />
            </Campo>
            <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
              <input type="checkbox" name="cerrado" className="size-4" />
              Cerrado
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
              <input type="checkbox" name="cerrado_llegada" className="size-4" />
              Sin llegadas
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
              <input type="checkbox" name="cerrado_salida" className="size-4" />
              Sin salidas
            </label>
            <Campo etiqueta="Motivo" ayuda="Para acordarse de por qué, dentro de tres meses.">
              <input
                name="nota"
                maxLength={200}
                placeholder="Fin de semana largo"
                className={`${CAMPO} w-56`}
              />
            </Campo>
            <BotonEnvio variante="secundario" cargando="Guardando…">
              Agregar
            </BotonEnvio>
          </form>
        ) : (
          <p className="mb-5 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600 ring-1 ring-stone-200">
            Cerrar fechas en un canal lo hace administración o gerencia: decide cuánto inventario se
            le deja a la OTA.
          </p>
        )}

        {restricciones.length === 0 ? (
          <EstadoVacio
            titulo="No hay restricciones vigentes"
            descripcion="Se publica lo que digan el cupo y el mapeo de cada tipo."
            icono="ocupacion"
          />
        ) : (
          <div className="overflow-x-auto">
            <Tabla resumen="Restricciones de venta por fecha, con el tramo, el tipo alcanzado y qué impone cada una.">
              <thead>
                <tr className={FILA}>
                  <th className={TH}>Fechas</th>
                  <th className={TH}>Alcanza a</th>
                  <th className={TH}>Qué impone</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Motivo</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {restricciones.map((r) => {
                  const tipo = tiposUnidad.find((t) => t.id === r.tipo_unidad_id)
                  const impone = [
                    r.cerrado ? 'Cerrado' : null,
                    r.minimo_noches ? `Mín. ${r.minimo_noches} noches` : null,
                    r.cerrado_llegada ? 'Sin llegadas' : null,
                    r.cerrado_salida ? 'Sin salidas' : null,
                  ].filter(Boolean)

                  return (
                    <tr key={r.id} className={FILA}>
                      <td className={`${TD} whitespace-nowrap`}>
                        {/*
                              Se muestra el último día INCLUIDO, no el fin del
                              rango: quien lee «hasta el 13» y ve que el bloqueo
                              termina el 12 concluye que el sistema le erró por un
                              día. Es lo mismo que hace `textoRango` con las
                              temporadas.
                            */}
                        {formatoFechaCorta(r.rango.desde)} al{' '}
                        {formatoFechaCorta(sumarDias(r.rango.hasta, -1))}
                      </td>
                      <td className={TD}>
                        {tipo ? tipo.nombre : <span className="text-stone-600">Todo el hotel</span>}
                      </td>
                      <td className={TD}>
                        <span className="flex flex-wrap gap-1.5">
                          {impone.map((i) => (
                            <Etiqueta key={i} tono={r.cerrado ? 'peligro' : 'alerta'}>
                              {i}
                            </Etiqueta>
                          ))}
                        </span>
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} text-xs text-stone-600`}>
                        {r.nota || '—'}
                      </td>
                      <td className={TD}>
                        {puedeConciliarCargos && (
                          <form action={borrarRestriccionCanal}>
                            <input type="hidden" name="id" value={r.id} />
                            <BotonEnvio
                              variante="fantasma"
                              extra="text-stone-600 hover:text-red-600"
                              cargando="Levantando…"
                              confirmar="¿Levantar esta restricción? Esas fechas vuelven a la venta normal en la próxima publicación."
                            >
                              Levantar
                            </BotonEnvio>
                          </form>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabla>
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Última publicación"
        descripcion="Que quede registrada aunque no salga nada es el punto: «no se actualiza» y «nadie lo corrió» son problemas distintos."
      >
        {ultimaSalida ? (
          <div className="space-y-2 text-sm text-stone-700">
            <p>
              <strong>{formatoFechaCorta(fechaDelHotel(ultimaSalida.corrida_en))}</strong> ·{' '}
              {horaHotel(ultimaSalida.corrida_en)} · proveedor {ultimaSalida.proveedor}
            </p>
            <p className="tabular">
              {ultimaSalida.leidas} filas calculadas · {ultimaSalida.actualizadas} aceptadas por el
              canal · {ultimaSalida.rechazadas} días sin tarifa cargada
            </p>
            {ultimaSalida.rechazadas > 0 && (
              <p className="rounded-lg bg-lenga-50 px-3 py-2 text-lenga-900 ring-1 ring-lenga-200">
                Los días sin tarifa <strong>no se publican</strong>, y es a propósito: publicar cero
                sería publicar una noche gratis. Cargá las temporadas que faltan para que esas
                fechas salgan a la venta.
              </p>
            )}
            {ultimaSalida.detalle && <p className="text-stone-600">{ultimaSalida.detalle}</p>}
          </div>
        ) : (
          <p className="text-sm text-stone-600">
            Todavía no se corrió ninguna publicación. Se dispara sola todos los días, o con el botón
            de acá abajo.
          </p>
        )}

        {puedeConciliarCargos && (
          <form action={publicarAhora} className="mt-4">
            <BotonEnvio variante="secundario" cargando="Publicando…">
              Publicar ahora
            </BotonEnvio>
          </form>
        )}
      </Tarjeta>
    </div>
  )
}
