'use client'

import { useActionState } from 'react'
import { crearProveedor, type EstadoProveedor } from './actions'

const ESTADO_INICIAL: EstadoProveedor = {}

export function FormularioProveedor() {
  const [estado, accion, pendiente] = useActionState(crearProveedor, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      <input name="nombre" placeholder="Nombre" required className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600" />
      <input name="rubro" placeholder="Rubro (ej: lavandería)" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600" />
      <input name="cuit" placeholder="CUIT" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600" />
      <input name="email" type="email" placeholder="Email" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600" />
      {estado.error && <p className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>}
      {estado.ok && <p className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{estado.ok}</p>}
      <button type="submit" disabled={pendiente} className="self-start rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800 disabled:opacity-60 sm:col-span-2">
        {pendiente ? 'Creando…' : 'Crear proveedor'}
      </button>
    </form>
  )
}
