'use client'

import { useFormStatus } from 'react-dom'
import { iniciarSesionConGoogle } from './actions'

/**
 * Entrada con Google.
 *
 * ── Por qué existe y qué NO hace ────────────────────────────────────────────
 *
 * Es una comodidad para el staff: en un puesto de recepción compartido, entrar
 * con la cuenta de Google del hotel evita tipear una contraseña delante del
 * huésped.
 *
 * **No es un registro.** `[auth].enable_signup = false` impide que GoTrue cree un
 * usuario nuevo por cualquier proveedor, así que esto solo funciona para alguien
 * cuyo email ya fue dado de alta por un administrador (ADR 0005 y 0017). Quien
 * entre con una cuenta desconocida no obtiene acceso: el callback lo detecta,
 * le cierra la sesión y le explica por qué.
 *
 * El componente solo se monta si el proveedor está configurado; la decisión la
 * toma el servidor (`googleHabilitado`). Un botón que existe y falla es peor que
 * un botón que no está — mismo criterio que el ADR 0018.
 */
export function BotonGoogle() {
  return (
    <form action={iniciarSesionConGoogle}>
      <BotonInterno />
    </form>
  )
}

function BotonInterno() {
  // `useFormStatus` tiene que leer el estado de un `<form>` que lo contenga, así
  // que va en un hijo y no en el mismo componente que declara el formulario.
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-stone-300 bg-white px-4 py-2.5 font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-wait disabled:opacity-70"
    >
      {/* Logotipo de Google, en sus colores oficiales. Decorativo: el texto del
          botón ya dice qué hace, así que se oculta a los lectores de pantalla. */}
      <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="#4285F4"
          d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.17-2 3.44-4.95 3.44-8.55Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.11 0 5.72-1.03 7.62-2.8l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.75H1.71v2.98A11.5 11.5 0 0 0 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.55 14.66a6.9 6.9 0 0 1 0-4.4V7.28H1.71a11.5 11.5 0 0 0 0 10.36l3.84-2.98Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.72 1.28 15.11.25 12 .25A11.5 11.5 0 0 0 1.71 7.28l3.84 2.98C6.46 7.53 9 4.75 12 4.75Z"
        />
      </svg>
      {pending ? 'Abriendo Google…' : 'Entrar con Google'}
    </button>
  )
}
