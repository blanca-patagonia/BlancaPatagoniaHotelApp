'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { iniciarSesion, type EstadoLogin } from './actions'

const ESTADO_INICIAL: EstadoLogin = {}

export function FormularioLogin() {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-stone-700">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          className="rounded-lg border border-stone-300 px-3 py-2.5 text-stone-900 outline-none transition focus:border-lago-600 focus:ring-2 focus:ring-lago-600/20"
          placeholder="admin@blancapatagonia.local"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-stone-700">Contraseña</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className="rounded-lg border border-stone-300 px-3 py-2.5 text-stone-900 outline-none transition focus:border-lago-600 focus:ring-2 focus:ring-lago-600/20"
          placeholder="••••••••"
        />
      </label>

      <Link
        href="/login/recuperar"
        className="-mt-2 self-end text-xs text-lago-700 hover:underline"
      >
        ¿Olvidaste tu contraseña?
      </Link>

      {estado.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="mt-2 rounded-lg bg-lago-700 px-4 py-2.5 font-medium text-white transition hover:bg-lago-800 disabled:opacity-60"
      >
        {pendiente ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  )
}
