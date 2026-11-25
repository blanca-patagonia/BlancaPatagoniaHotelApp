'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { avisoDeEspacios } from '@/lib/domain/cuenta'
import { Icono } from '../panel/_components/iconos'
import { iniciarSesion, type EstadoLogin } from './actions'

const ESTADO_INICIAL: EstadoLogin = {}

const CAMPO =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-stone-900 outline-none transition focus:border-lago-600 focus:ring-2 focus:ring-lago-600/20'

export function FormularioLogin() {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, ESTADO_INICIAL)
  const v = estado.valores ?? {}

  /*
    Ver la contraseña. Al pegarla desde un correo se puede colar un espacio, y
    con el campo enmascarado no hay forma de notarlo: el ingreso falla y el
    mensaje no dice por qué (le pasó al docente al probar la demo).
  */
  const [visible, setVisible] = useState(false)
  const [password, setPassword] = useState('')
  const aviso = avisoDeEspacios(password)

  return (
    <form action={accion} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-stone-700">Email</span>
        <input
          type="email"
          name="email"
          defaultValue={v.email ?? ''}
          autoComplete="email"
          required
          className={CAMPO}
        />
      </label>

      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor="password" className="font-medium text-stone-700">
          Contraseña
        </label>
        <div className="relative">
          <input
            id="password"
            type={visible ? 'text' : 'password'}
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            aria-describedby={aviso ? 'aviso-espacios' : undefined}
            className={`${CAMPO} pr-24`}
          />
          {/* Con texto y no sólo un ojo: «Mostrar» se entiende sin conocer el icono. */}
          <button
            type="button"
            onClick={() => setVisible((x) => !x)}
            aria-pressed={visible}
            aria-controls="password"
            className="absolute inset-y-1 right-1 inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
          >
            <Icono nombre={visible ? 'ojo_tachado' : 'ojo'} tam={16} />
            {visible ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        {aviso && (
          <p id="aviso-espacios" className="text-xs text-lenga-800" role="status">
            {aviso}
          </p>
        )}
      </div>

      <Link href="/login/recuperar" className="-mt-2 self-end text-xs text-lago-700 hover:underline">
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
        className="mt-1 rounded-lg bg-lago-700 px-4 py-2.5 font-medium text-white transition hover:bg-lago-800 disabled:opacity-60"
      >
        {pendiente ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  )
}
