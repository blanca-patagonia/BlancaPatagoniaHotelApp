'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { fijarNuevaPassword, type EstadoNuevaPassword } from '../actions'

const ESTADO_INICIAL: EstadoNuevaPassword = {}

const CAMPO =
  'rounded-lg border border-stone-300 px-3 py-2.5 text-stone-900 outline-none transition focus:border-lago-600 focus:ring-2 focus:ring-lago-600/20'

export function FormularioNuevaPassword({ largoMinimo }: { largoMinimo: number }) {
  const [estado, accion, pendiente] = useActionState(fijarNuevaPassword, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-stone-700">Contraseña nueva</span>
        <input
          type="password"
          name="nueva"
          autoComplete="new-password"
          required
          minLength={largoMinimo}
          className={CAMPO}
        />
        <span className="text-xs text-stone-500">Al menos {largoMinimo} caracteres.</span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-stone-700">Repetila</span>
        <input
          type="password"
          name="repetida"
          autoComplete="new-password"
          required
          className={CAMPO}
        />
      </label>

      {estado.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        aria-busy={pendiente}
        className="rounded-lg bg-lago-700 px-4 py-2.5 font-medium text-white transition hover:bg-lago-800 disabled:cursor-wait disabled:opacity-70"
      >
        {pendiente ? 'Guardando…' : 'Guardar y entrar'}
      </button>

      <Link href="/login" className="text-center text-sm text-stone-500 hover:text-stone-800">
        Volver
      </Link>
    </form>
  )
}
