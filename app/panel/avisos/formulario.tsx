'use client'

import { useActionState } from 'react'
import { publicarAviso, type EstadoAviso } from './actions'

const ESTADO_INICIAL: EstadoAviso = {}

export function FormularioAviso() {
  const [estado, accion, pendiente] = useActionState(publicarAviso, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-col gap-2">
      <textarea
        name="mensaje"
        rows={2}
        required
        placeholder="Escribí un aviso para el equipo…"
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600"
      />
      {estado.error && <p className="text-sm text-red-700">{estado.error}</p>}
      <button
        type="submit"
        disabled={pendiente}
        className="self-start rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800 disabled:opacity-60"
      >
        {pendiente ? 'Publicando…' : 'Publicar aviso'}
      </button>
    </form>
  )
}
