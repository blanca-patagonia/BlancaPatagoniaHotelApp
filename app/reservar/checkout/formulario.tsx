'use client'

import { useActionState } from 'react'
import { crearReservaPublica, type EstadoReservaPublica } from '../actions'
import { CAMPO_PUBLICO, Campo, Mensaje, botonPublico } from '../../_publico/ui'

const ESTADO_INICIAL: EstadoReservaPublica = {}

/**
 * Datos de contacto del huésped para cerrar la reserva.
 *
 * Se piden cuatro campos y nada más: cada campo extra en un formulario público
 * es gente que lo abandona. El resto —documento, nacionalidad, condición frente
 * al IVA— se completa en recepción durante el check-in, cuando la persona ya
 * está y tiene el documento en la mano.
 */
export function FormularioCheckout({
  tipo,
  checkIn,
  checkOut,
  huespedes,
}: {
  tipo: string
  checkIn: string
  checkOut: string
  huespedes: number
}) {
  const [estado, accion, pendiente] = useActionState(crearReservaPublica, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-col gap-5">
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="check_in" value={checkIn} />
      <input type="hidden" name="check_out" value={checkOut} />
      <input type="hidden" name="huespedes" value={huespedes} />

      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <Campo etiqueta="Apellido" requerido>
          <input name="apellido" required className={CAMPO_PUBLICO} />
        </Campo>
        <Campo etiqueta="Nombre">
          <input name="nombre" className={CAMPO_PUBLICO} />
        </Campo>
        <Campo
          etiqueta="Email"
          requerido
          ayuda="Acá te mandamos la confirmación con el código de tu reserva."
          anchoCompleto
        >
          <input name="email" type="email" required className={CAMPO_PUBLICO} />
        </Campo>
        <Campo
          etiqueta="Teléfono"
          ayuda="Opcional. Sirve para avisarte si surge algo con tu llegada."
          anchoCompleto
        >
          <input name="telefono" type="tel" className={CAMPO_PUBLICO} />
        </Campo>
      </div>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}

      <div>
        <button
          type="submit"
          disabled={pendiente}
          className={botonPublico('primario', 'w-full sm:w-auto')}
        >
          {pendiente ? 'Reservando…' : 'Confirmar la reserva'}
        </button>
        <p className="mt-3 text-sm leading-relaxed text-stone-500">
          No se te cobra nada ahora. La reserva queda tomada y te escribimos para coordinar la
          seña, que equivale a la primera noche.
        </p>
      </div>
    </form>
  )
}
