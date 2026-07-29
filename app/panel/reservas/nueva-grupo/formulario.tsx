'use client'

import { useActionState } from 'react'
import { crearReservaGrupal, type EstadoReservaGrupal } from '../actions'

export interface OpcionGrupo {
  tipoUnidadId: string
  nombre: string
  disponibles: number
}

const ESTADO_INICIAL: EstadoReservaGrupal = {}

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
    <form action={accion} className="mt-6 flex flex-col gap-5">
      <input type="hidden" name="check_in" value={checkIn} />
      <input type="hidden" name="check_out" value={checkOut} />

      <div>
        <h2 className="mb-2 text-sm font-medium text-stone-700">Unidades por tipo</h2>
        <div className="flex flex-col gap-2">
          {opciones.map((o) => (
            <label
              key={o.tipoUnidadId}
              className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm"
            >
              <span className="text-stone-800">
                {o.nombre}
                <span className="ml-2 text-xs text-stone-400">{o.disponibles} libre(s)</span>
              </span>
              <input
                type="number"
                name={`qty_${o.tipoUnidadId}`}
                min={0}
                max={o.disponibles}
                defaultValue={0}
                className="w-20 rounded-md border border-stone-300 px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-stone-700">Titular del grupo</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="apellido" placeholder="Apellido *" required className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600" />
          <input name="nombre" placeholder="Nombre" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600" />
          <input name="email" type="email" placeholder="Email" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600" />
          <select name="canal" defaultValue="directo" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600">
            <option value="directo">Directo (rack)</option>
            <option value="web">Web (rack)</option>
            <option value="booking">Booking (neto)</option>
            <option value="expedia">Expedia (neto)</option>
          </select>
        </div>
      </div>

      {estado.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="self-start rounded-lg bg-sky-700 px-5 py-2.5 font-medium text-white transition hover:bg-sky-800 disabled:opacity-60"
      >
        {pendiente ? 'Creando grupo…' : 'Crear reserva grupal'}
      </button>
    </form>
  )
}
