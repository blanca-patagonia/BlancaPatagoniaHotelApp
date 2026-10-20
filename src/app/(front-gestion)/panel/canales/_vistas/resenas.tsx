import type { DatosCanales } from '../_datos'
import Link from 'next/link'
import { formatoFechaCorta } from '@/lib/fechas'
import { BotonEnvio } from '../../_components/boton-envio'
import { CAMPO, Campo, EstadoVacio, Etiqueta, Tarjeta } from '../../_components/ui'
import { ImportarResenas } from '../importar-resenas'
import { cargarResena, vincularResena, responderResena } from '../actions'

/** Vista «resenas» de la pantalla de canales. Los datos los carga `_datos.ts`. */
export function VistaResenas({ d }: { d: DatosCanales }) {
  const { entrantes, resenas } = d
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Tarjeta
        titulo="Reseñas publicadas"
        descripcion="Las de Booking. El NPS propio se mide aparte, en las encuestas."
        className="lg:col-span-2"
      >
        {resenas.length === 0 ? (
          <EstadoVacio
            titulo="No hay reseñas cargadas"
            descripcion="Subí el export de reseñas del extranet acá al lado, o cargá una a mano. La API de reseñas de Booking es de partner, así que el archivo es el único camino."
            icono="firma"
          />
        ) : (
          <ul className="divide-y divide-stone-100">
            {resenas.map((r) => (
              <li key={r.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800">
                      {r.autor}
                      {r.puntaje != null && (
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-xs font-semibold ${
                            Number(r.puntaje) >= 8
                              ? 'bg-emerald-100 text-emerald-900'
                              : Number(r.puntaje) >= 6
                                ? 'bg-lenga-100 text-lenga-900'
                                : 'bg-red-100 text-red-900'
                          }`}
                        >
                          {Number(r.puntaje).toFixed(1)} / 10
                        </span>
                      )}
                    </p>
                    {r.publicada_en && (
                      <p className="text-xs text-stone-500">{formatoFechaCorta(r.publicada_en)}</p>
                    )}
                  </div>
                  {r.respondida && <Etiqueta tono="exito">Respondida</Etiqueta>}
                </div>

                {r.positivo && (
                  <p className="mt-2 text-sm text-stone-700">
                    <span className="font-medium text-emerald-700">Le gustó:</span> {r.positivo}
                  </p>
                )}
                {r.negativo && (
                  <p className="mt-1 text-sm text-stone-700">
                    <span className="font-medium text-red-700">No le gustó:</span> {r.negativo}
                  </p>
                )}

                {r.respondida ? (
                  <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
                    <span className="font-medium">Respuesta del hotel:</span> {r.respuesta}
                  </p>
                ) : (
                  <form action={responderResena} className="mt-2 flex flex-col gap-2">
                    <input type="hidden" name="resena_id" value={r.id} />
                    <Campo etiqueta="Respuesta del hotel">
                      <textarea name="respuesta" rows={2} required className={CAMPO} />
                    </Campo>
                    <BotonEnvio
                      variante="secundario"
                      cargando="Guardando…"
                      extra="w-full sm:w-auto"
                    >
                      Guardar respuesta
                    </BotonEnvio>
                  </form>
                )}

                {/*
                      El vínculo con la reserva.

                      Una reseña ligada sirve para bastante más que leerla: dice qué
                      unidad la produjo, se cruza con el NPS propio y muestra si el
                      huésped que se queja ya se había quejado.

                      Cuando el emparejamiento fue ambiguo NO se adivinó, y acá se dice
                      por qué: una reseña mal ligada ensucia el historial de alguien que
                      no dijo eso, y eso es peor que una sin ligar.
                    */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2">
                  {r.reserva ? (
                    <>
                      <Etiqueta tono="exito">
                        {r.vinculo === 'manual' ? 'Ligada a mano' : 'Ligada'}
                      </Etiqueta>
                      <Link
                        href={`/panel/reservas/${r.reserva.id}`}
                        className="font-mono text-xs text-lago-700 underline"
                      >
                        {r.reserva.codigo}
                      </Link>
                      <form action={vincularResena}>
                        <input type="hidden" name="resena_id" value={r.id} />
                        <input type="hidden" name="reserva_id" value="" />
                        <BotonEnvio variante="fantasma" cargando="…" extra="px-2 py-1 text-xs">
                          Desligar
                        </BotonEnvio>
                      </form>
                    </>
                  ) : (
                    <>
                      <Etiqueta tono="alerta">Sin ligar</Etiqueta>
                      {r.motivo_sin_vinculo && (
                        <span className="text-xs text-stone-600">{r.motivo_sin_vinculo}</span>
                      )}
                      <form action={vincularResena} className="flex items-center gap-1">
                        <input type="hidden" name="resena_id" value={r.id} />
                        <select
                          name="reserva_id"
                          defaultValue=""
                          aria-label={`Reserva a la que corresponde la reseña de ${r.autor}`}
                          className="rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                        >
                          <option value="">— Elegí la reserva —</option>
                          {entrantes
                            .filter((e) => e.reserva_id && e.reserva?.codigo)
                            .map((e) => (
                              <option key={e.id} value={e.reserva_id!}>
                                {e.huesped_apellido} · {e.reserva!.codigo} ·{' '}
                                {formatoFechaCorta(e.check_out)}
                              </option>
                            ))}
                        </select>
                        <BotonEnvio variante="fantasma" cargando="…" extra="px-2 py-1 text-xs">
                          Ligar
                        </BotonEnvio>
                      </form>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <div className="grid gap-4">
        <Tarjeta
          titulo="Importar el export de reseñas"
          descripcion="Desde la sección Reseñas del extranet."
        >
          <ImportarResenas />
        </Tarjeta>

        <Tarjeta titulo="Cargar una reseña a mano">
          <form action={cargarResena} className="flex flex-col gap-3 p-5">
            <Campo etiqueta="Autor">
              <input name="autor" className={CAMPO} placeholder="Nombre o «Anónimo»" />
            </Campo>
            <Campo etiqueta="Puntaje" ayuda="Escala de Booking: 0 a 10, con un decimal.">
              <input
                name="puntaje"
                type="number"
                step="0.1"
                min="0"
                max="10"
                required
                className={CAMPO}
              />
            </Campo>
            <Campo etiqueta="Le gustó">
              <textarea name="positivo" rows={2} className={CAMPO} />
            </Campo>
            <Campo etiqueta="No le gustó">
              <textarea name="negativo" rows={2} className={CAMPO} />
            </Campo>
            <Campo etiqueta="Fecha de publicación">
              <input name="publicada_en" type="date" className={CAMPO} />
            </Campo>
            <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
              Guardar reseña
            </BotonEnvio>
          </form>
        </Tarjeta>
      </div>
    </div>
  )
}
