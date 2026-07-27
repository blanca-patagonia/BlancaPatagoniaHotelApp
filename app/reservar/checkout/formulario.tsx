'use client'

import { useActionState } from 'react'
import { crearReservaPublica, type EstadoReservaPublica } from '../actions'

const ESTADO_INICIAL: EstadoReservaPublica = {}

export function FormularioCheckout({
  tipo,
  checkIn,
  checkOut,
  huespedes,
}: {
  tipo: string
  checkIn: string
  checkOut: string
  huespedes: number
}) {
  const [estado, accion, pendiente] = useActionState(crearReservaPublica, ESTADO_INICIAL)

  return (
    <form action={accion} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="check_in" value={checkIn} />
      <input type="hidden" name="check_out" value={checkOut} />
      <input type="hidden" name="huespedes" value={huespedes} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Apellido" nombre="apellido" requerido />
        <Campo etiqueta="Nombre" nombre="nombre" />
        <Campo etiqueta="Email" nombre="email" tipo="email" requerido />
        <Campo etiqueta="Teléfono" nombre="telefono" />
      </div>

      {estado.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="self-start rounded-lg bg-sky-700 px-6 py-3 font-medium text-white transition hover:bg-sky-800 disabled:opacity-60"
      >
        {pendiente ? 'Reservando…' : 'Confirmar reserva'}
      </button>
      <p className="text-xs text-stone-400">
        Tu reserva queda pendiente hasta el pago de la seña (primera noche).
      </p>
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
