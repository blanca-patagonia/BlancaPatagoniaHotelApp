'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearReservaGrupal, type EstadoReservaGrupal } from '../actions'
import {
  CAMPO,
  Campo,
  Mensaje,
  PieDeFormulario,
  Tarjeta,
  botonClases,
} from '../../_components/ui'

export interface OpcionGrupo {
  tipoUnidadId: string
  nombre: string
  disponibles: number
}

const ESTADO_INICIAL: EstadoReservaGrupal = {}

/**
 * Alta de una reserva grupal: varias unidades que comparten un `grupo_id` y un
 * titular. Cada unidad se crea con el mismo alta atómica de siempre, así que el
 * anti-overbooking sigue valiendo para el grupo entero.
 */
export function FormularioGrupo({
  opciones,
  checkIn,
  checkOut,
}: {
  opciones: OpcionGrupo[]
  checkIn: string
  checkOut: string
}) {
  const [estado, accion, pendiente] = useActionState(crearReservaGrupal, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-col gap-4">
      <input type="hidden" name="check_in" value={checkIn} />
      <input type="hidden" name="check_out" value={checkOut} />

      <Tarjeta
        titulo="2 · ¿Cuántas unidades de cada tipo?"
        descripcion="Solo se ofrecen las que están libres en esas fechas."
      >
        <div className="flex flex-col gap-2 p-5">
          {opciones.map((o) => (
            <label
              key={o.tipoUnidadId}
              className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 px-4 py-3 transition hover:border-lago-300"
            >
              <span className="min-w-0 text-stone-800">
                {o.nombre}
                <span className="mt-0.5 block text-xs text-stone-500">
                  {o.disponibles} libre{o.disponibles === 1 ? '' : 's'}
                </span>
              </span>
              <input
                type="number"
                name={`qty_${o.tipoUnidadId}`}
                min={0}
                max={o.disponibles}
                defaultValue={0}
                aria-label={`Cantidad de ${o.nombre}`}
                className="toque w-20 shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-center outline-none focus:border-lago-600"
              />
            </label>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="3 · ¿A nombre de quién?"
        descripcion="El titular responde por el grupo. Las reservas quedan asociadas a esta persona."
      >
        <div className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
          <Campo etiqueta="Apellido" requerido>
            <input name="apellido" required className={CAMPO} />
          </Campo>
          <Campo etiqueta="Nombre">
            <input name="nombre" className={CAMPO} />
          </Campo>
          <Campo etiqueta="Email" ayuda="Ahí llega la confirmación del grupo.">
            <input name="email" type="email" className={CAMPO} />
          </Campo>
          <Campo
            etiqueta="Canal de venta"
            ayuda="Define si se cotiza con tarifa de mostrador (rack) o neta."
          >
            <select name="canal" defaultValue="directo" className={CAMPO}>
              <option value="directo">Directo (rack)</option>
              <option value="web">Web (rack)</option>
              <option value="booking">Booking (neto)</option>
              <option value="expedia">Expedia (neto)</option>
            </select>
          </Campo>
        </div>
      </Tarjeta>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}

      {/*
        El grupo entró a medias. NO es un error —las reservas creadas son válidas y
        conviene quedarse con ellas— pero tampoco es el éxito que se pidió, así que
        no se redirige como si nada: se dice cuántas entraron, cuántas faltan y por
        qué, y se ofrece el link al grupo.

        Antes esto era invisible: `primerError` se descartaba cuando había al menos
        una reserva creada, y quien pedía 5 unidades y recibía 2 veía la misma
        pantalla que quien recibía las 5.
      */}
      {estado.parcial && (
        <div
          role="status"
          className="mb-4 rounded-xl bg-lenga-50 px-4 py-3 text-sm text-lenga-900 ring-1 ring-lenga-200"
        >
          <p className="font-semibold">
            El grupo se creó con {estado.parcial.creadas} de las {estado.parcial.pedidas} unidades
            pedidas.
          </p>
          <p className="mt-1 text-stone-700">
            Faltan {estado.parcial.pedidas - estado.parcial.creadas}. {estado.parcial.motivo}
          </p>
          <p className="mt-2">
            Las {estado.parcial.creadas} que entraron ya están confirmadas y agrupadas.{' '}
            <Link
              href={`/panel/reservas?grupo=${estado.parcial.grupoId}`}
              className="font-semibold underline"
            >
              Ver el grupo
            </Link>{' '}
            para revisarlo, o cambiá las fechas y volvé a intentar por las que faltan.
          </p>
        </div>
      )}

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('primario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Creando el grupo…' : 'Crear la reserva grupal'}
        </button>
        <Link href="/panel/reservas" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
