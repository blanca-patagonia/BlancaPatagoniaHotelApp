'use client'

import { useActionState } from 'react'
import { guardarContacto, type EstadoContacto } from './actions'
import { CAMPO, Campo, botonClases } from '../_components/ui'

/** Edición del contacto, en la columna derecha de la bandeja. */
export function FormContacto({
  contacto,
}: {
  contacto: { id: string; nombre: string; email: string | null; telefono: string | null; notas: string | null }
}) {
  const [estado, accion, guardando] = useActionState<EstadoContacto, FormData>(guardarContacto, {})

  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="contacto_id" value={contacto.id} />
      <Campo etiqueta="Nombre">
        <input name="nombre" defaultValue={contacto.nombre} className={CAMPO} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Email">
        <input name="email" type="email" defaultValue={contacto.email ?? ''} className={CAMPO} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Teléfono">
        <input name="telefono" defaultValue={contacto.telefono ?? ''} className={CAMPO} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Notas del contacto" ayuda="Las ve todo el equipo que atiende la bandeja.">
        <textarea name="notas" rows={3} defaultValue={contacto.notas ?? ''} className={CAMPO} />
      </Campo>
      {estado.error && (
        <p className="text-sm text-red-700" role="alert">
          {estado.error}
        </p>
      )}
      {estado.ok && !guardando && (
        <p className="text-sm text-emerald-700" role="status">
          Contacto guardado.
        </p>
      )}
      <button type="submit" disabled={guardando} className={botonClases('secundario', 'w-full')}>
        {guardando ? 'Guardando…' : 'Guardar contacto'}
      </button>
    </form>
  )
}
