'use client'

import { useActionState } from 'react'
import { mandarCorreoDePrueba, type EstadoPrueba } from './actions'
import { BotonEnvio } from '../_components/boton-envio'
import { Campo, CAMPO, Mensaje } from '../_components/ui'

/**
 * El botón que responde «¿los correos salen de verdad?».
 *
 * Es de cliente porque muestra el resultado **sin recargar** y sin pasar por la
 * URL: el motivo que devuelve el proveedor —«domain is not verified», «API key is
 * invalid»— es un texto largo y técnico que no tiene por qué viajar en un
 * `?error=`, donde además quedaría en el historial del navegador.
 */
export function PruebaDeCorreo({ sugerido }: { sugerido: string }) {
  const [estado, accion] = useActionState<EstadoPrueba, FormData>(mandarCorreoDePrueba, {})

  return (
    <form action={accion} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Campo
          etiqueta="Mandar una prueba a"
          ayuda="Tu propia dirección sirve: es para ver si sale, no a quién."
        >
          <input
            type="email"
            name="para"
            defaultValue={sugerido}
            required
            className={`${CAMPO} w-72`}
          />
        </Campo>
        <BotonEnvio variante="secundario" cargando="Mandando…">
          Probar el envío
        </BotonEnvio>
      </div>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && <Mensaje tono="ok">{estado.ok}</Mensaje>}
    </form>
  )
}
