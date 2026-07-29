'use client'

import { useActionState } from 'react'
import { crearAgencia, type EstadoAgencia } from './actions'
import { TIPOS_CUENTA, ETIQUETAS_TIPO_CUENTA } from '@/lib/domain/cuentas'

const ESTADO_INICIAL: EstadoAgencia = {}

export function FormularioAgencia() {
  const [estado, accion, pendiente] = useActionState(crearAgencia, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      <input
        name="nombre"
        placeholder="Nombre"
        required
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600"
      />
      <select
        name="tipo"
        defaultValue="agencia"
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600"
      >
        {TIPOS_CUENTA.map((t) => (
          <option key={t} value={t}>
            {ETIQUETAS_TIPO_CUENTA[t]}
          </option>
        ))}
      </select>
      <input
        name="cuit"
        placeholder="CUIT"
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600"
      />
      <input
        name="email"
        type="email"
        placeholder="Email"
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600"
      />
      <label className="flex items-center gap-2 text-sm text-stone-600">
        Descuento %
        <input
          name="descuento_pct"
          type="number"
          min={0}
          max={100}
          step="0.5"
          defaultValue={0}
          className="w-20 rounded-lg border border-stone-300 px-2 py-2 text-sm outline-none focus:border-sky-600"
        />
      </label>

      {estado.error && (
        <p className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
      )}
      {estado.ok && (
        <p className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{estado.ok}</p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="self-start rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:opacity-60 sm:col-span-2"
      >
        {pendiente ? 'Creando…' : 'Crear agencia'}
      </button>
    </form>
  )
}
