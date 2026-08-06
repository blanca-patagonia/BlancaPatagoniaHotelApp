'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'
import { botonClases, type VarianteBoton } from './ui'

/**
 * Botón de envío que se bloquea mientras la acción está en curso.
 *
 * Por qué hace falta: la mayoría de los formularios del panel viven en
 * componentes de **servidor** (`<form action={accionDeServidor}>`), que no
 * pueden usar `useActionState` para saber si hay un envío en vuelo. Sin eso, el
 * botón queda igual después de apretarlo y no pasa nada visible durante el
 * viaje al servidor. Quien no está acostumbrado vuelve a apretar —y en
 * "Registrar pago" o "Facturar" eso significa **duplicar la operación**.
 *
 * `useFormStatus` sí funciona ahí: lee el estado del `<form>` que lo contiene,
 * siempre que el botón sea un componente de cliente hijo del formulario. Este
 * archivo es esa pieza mínima de cliente.
 *
 * Es una red de seguridad de interfaz, no la garantía: las reglas que impiden
 * facturar dos veces siguen estando en el dominio y en la base.
 */
export function BotonEnvio({
  children,
  cargando,
  variante = 'primario',
  extra = '',
  confirmar,
}: {
  children: ReactNode
  /** Texto mientras se procesa. Por defecto, "Guardando…". */
  cargando?: string
  variante?: VarianteBoton
  extra?: string
  /** Si se indica, se pide confirmación antes de enviar. */
  confirmar?: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={
        confirmar
          ? (e) => {
              if (!window.confirm(confirmar)) e.preventDefault()
            }
          : undefined
      }
      className={botonClases(variante, `disabled:cursor-wait disabled:opacity-70 ${extra}`)}
    >
      {pending && <Girador />}
      {pending ? (cargando ?? 'Guardando…') : children}
    </button>
  )
}

/** Indicador circular de progreso. SVG propio: el proyecto no usa librerías de iconos. */
function Girador() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
