'use client'

import { useActionState } from 'react'
import { CAMPO, Campo, ExitoConPasos, Mensaje, PieDeFormulario, botonClases } from '../_components/ui'
import { LARGO_MINIMO_PASSWORD } from '@/lib/domain/cuenta'
import { cambiarMiPassword, type EstadoCuenta } from './actions'

const ESTADO_INICIAL: EstadoCuenta = {}

/**
 * Cambio de la propia contraseña.
 *
 * Los tres campos llevan etiqueta visible y `autoComplete` correcto para que el
 * gestor de contraseñas del navegador entienda qué es cada uno: sin
 * `new-password` en los dos últimos, ofrece autocompletar la vieja y la persona
 * termina «cambiándola» por la misma.
 */
export function FormularioCuenta() {
  const [estado, accion, pendiente] = useActionState(cambiarMiPassword, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-5 sm:max-w-md">
      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}

      {estado.ok && (
        <ExitoConPasos
          mensaje={estado.ok}
          pasos={[{ href: '/panel', texto: 'Volver al inicio' }]}
        />
      )}

      <Campo etiqueta="Contraseña actual" requerido>
        <input
          type="password"
          name="actual"
          autoComplete="current-password"
          required
          className={CAMPO}
        />
      </Campo>

      <Campo
        etiqueta="Contraseña nueva"
        requerido
        ayuda={`Al menos ${LARGO_MINIMO_PASSWORD} caracteres, y distinta de la actual.`}
      >
        <input
          type="password"
          name="nueva"
          autoComplete="new-password"
          minLength={LARGO_MINIMO_PASSWORD}
          required
          className={CAMPO}
        />
      </Campo>

      <Campo etiqueta="Repetí la contraseña nueva" requerido>
        <input
          type="password"
          name="repetida"
          autoComplete="new-password"
          minLength={LARGO_MINIMO_PASSWORD}
          required
          className={CAMPO}
        />
      </Campo>

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('primario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Cambiando…' : 'Cambiar contraseña'}
        </button>
      </PieDeFormulario>
    </form>
  )
}
