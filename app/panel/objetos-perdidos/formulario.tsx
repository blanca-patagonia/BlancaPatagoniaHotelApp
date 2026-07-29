'use client'

import { useActionState } from 'react'
import { crearObjeto, type EstadoObjeto } from './actions'

const ESTADO_INICIAL: EstadoObjeto = {}

export function FormularioObjeto() {
  const [estado, accion, pendiente] = useActionState(crearObjeto, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-wrap items-end gap-2">
      <input name="descripcion" placeholder="Objeto (ej: campera azul)" required className="min-w-56 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600" />
      <input name="ubicacion" placeholder="Dónde se encontró" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600" />
      <button type="submit" disabled={pendiente} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:opacity-60">
        {pendiente ? 'Registrando…' : 'Registrar'}
      </button>
      {estado.error && <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>}
      {estado.ok && <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{estado.ok}</p>}
    </form>
  )
}
