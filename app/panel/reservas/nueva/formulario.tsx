'use client'

import { useActionState } from 'react'
import { crearReservaAction, type EstadoNuevaReserva } from '../actions'

export interface OpcionTipo {
  tipoUnidadId: string
  nombre: string
  categoria: string
  capacidadMax: number
  disponibles: number
  total: number
  faltanTarifas: boolean
}

const ESTADO_INICIAL: EstadoNuevaReserva = {}

export function FormularioReserva({
  opciones,
  checkIn,
  checkOut,
  huespedes,
  noches,
}: {
  opciones: OpcionTipo[]
  checkIn: string
  checkOut: string
  huespedes: number
  noches: number
}) {
  const [estado, accion, pendiente] = useActionState(crearReservaAction, ESTADO_INICIAL)

  return (
    <form action={accion} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="check_in" value={checkIn} />
      <input type="hidden" name="check_out" value={checkOut} />
      <input type="hidden" name="huespedes" value={huespedes} />

      <div>
        <h2 className="mb-2 text-sm font-medium text-stone-700">
          Unidad disponible ({noches} {noches === 1 ? 'noche' : 'noches'})
        </h2>
        <div className="flex flex-col gap-2">
          {opciones.map((o, i) => (
            <label
              key={o.tipoUnidadId}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 transition hover:border-sky-400 has-[:checked]:border-sky-600 has-[:checked]:bg-sky-50"
            >
              <input
                type="radio"
                name="tipo_unidad_id"
                value={o.tipoUnidadId}
                defaultChecked={i === 0}
                required
                className="accent-sky-600"
              />
              <span className="flex-1">
                <span className="font-medium text-stone-800">{o.nombre}</span>
                <span className="ml-2 text-xs text-stone-400">
                  hasta {o.capacidadMax} · {o.disponibles} libre(s)
                </span>
              </span>
              <span className="text-right">
                <span className="font-semibold text-stone-900">USD {o.total.toLocaleString('es-AR')}</span>
                <span className="block text-xs text-stone-400">total ref. (mostrador)</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Apellido" nombre="apellido" requerido />
        <Campo etiqueta="Nombre" nombre="nombre" />
        <Campo etiqueta="Email" nombre="email" tipo="email" />
        <Campo etiqueta="Documento" nombre="doc_numero" />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-stone-700">Canal</span>
          <select
            name="canal"
            defaultValue="directo"
            className="rounded-lg border border-stone-300 px-3 py-2.5 text-stone-900 outline-none focus:border-sky-600"
          >
            <option value="directo">Directo / Mostrador (rack)</option>
            <option value="web">Web (rack)</option>
            <option value="booking">Booking (neto)</option>
            <option value="expedia">Expedia (neto)</option>
          </select>
        </label>
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
        {pendiente ? 'Confirmando…' : 'Confirmar reserva'}
      </button>
    </form>
  )
}

function Campo({
  etiqueta,
  nombre,
  tipo = 'text',
  requerido = false,
}: {
  etiqueta: string
  nombre: string
  tipo?: string
  requerido?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-stone-700">
        {etiqueta}
        {requerido && <span className="text-red-500"> *</span>}
      </span>
      <input
        type={tipo}
        name={nombre}
        required={requerido}
        className="rounded-lg border border-stone-300 px-3 py-2.5 text-stone-900 outline-none focus:border-sky-600"
      />
    </label>
  )
}
