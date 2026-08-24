'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { pedirRecuperacion, type EstadoRecuperar } from '../actions'

const ESTADO_INICIAL: EstadoRecuperar = {}

const CAMPO =
  'rounded-lg border border-stone-300 px-3 py-2.5 text-stone-900 outline-none transition focus:border-lago-600 focus:ring-2 focus:ring-lago-600/20'

export function FormularioRecuperar() {
  const [estado, accion, pendiente] = useActionState(pedirRecuperacion, ESTADO_INICIAL)

  // Con el enlace ya enviado no se muestra el formulario de nuevo: volver a
  // enviarlo sin querer gasta el límite de tres por hora.
  if (estado.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-lenga-50 px-3 py-3 text-sm text-lenga-900" role="status">
          {estado.ok}
        </p>
        <Link href="/login" className="text-center text-sm text-lago-700 hover:underline">
          Volver a ingresar
        </Link>
      </div>
    )
  }

  return (
    <form action={accion} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-stone-700">Email de tu cuenta</span>
        <input type="email" name="email" autoComplete="email" required className={CAMPO} />
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
        {pendiente ? 'Enviando…' : 'Enviarme el enlace'}
      </button>

      <Link href="/login" className="text-center text-sm text-stone-500 hover:text-stone-800">
        Volver
      </Link>
    </form>
  )
}
