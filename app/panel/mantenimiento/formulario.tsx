'use client'

import { useActionState } from 'react'
import { crearOrden, type EstadoOrden } from './actions'

const ESTADO_INICIAL: EstadoOrden = {}

export function FormularioOrden({ unidades }: { unidades: { id: string; nombre: string }[] }) {
  const [estado, accion, pendiente] = useActionState(crearOrden, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      <input name="titulo" placeholder="Título (ej: pérdida de agua)" required className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600 sm:col-span-2" />
      <select name="unidad_id" defaultValue="" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600">
        <option value="">Sin unidad / general</option>
        {unidades.map((u) => (
          <option key={u.id} value={u.id}>{u.nombre}</option>
        ))}
      </select>
      <select name="prioridad" defaultValue="media" className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600">
        <option value="baja">Prioridad baja</option>
        <option value="media">Prioridad media</option>
        <option value="alta">Prioridad alta</option>
      </select>
      <textarea name="descripcion" placeholder="Descripción" rows={2} className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600 sm:col-span-2" />

      {estado.error && <p className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>}
      {estado.ok && <p className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{estado.ok}</p>}

      <button type="submit" disabled={pendiente} className="self-start rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:opacity-60 sm:col-span-2">
        {pendiente ? 'Creando…' : 'Crear orden'}
      </button>
    </form>
  )
}
