'use client'

import { useActionState } from 'react'
import { publicarAviso, type EstadoAviso } from './actions'
import { CAMPO, Campo, Mensaje, botonClases } from '../_components/ui'

const ESTADO_INICIAL: EstadoAviso = {}

/**
 * Publicación de un aviso en el tablón.
 *
 * Confirma explícitamente al publicar. El aviso aparece en la lista de abajo,
 * pero eso solo se nota si uno ya sabe dónde mirar: al terminar, el campo queda
 * vacío y sin el mensaje no hay forma de distinguir «se publicó» de «no pasó
 * nada».
 */
export function FormularioAviso() {
  const [estado, accion, pendiente] = useActionState(publicarAviso, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-col gap-3">
      <Campo etiqueta="Aviso para el equipo" ayuda="Lo ve todo el personal en su tablón.">
        <textarea
          name="mensaje"
          rows={3}
          required
          placeholder="Mañana llega un grupo de 12 a las 14:00…"
          className={CAMPO}
        />
      </Campo>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && <Mensaje tono="ok">{estado.ok}</Mensaje>}

      <button
        type="submit"
        disabled={pendiente}
        className={botonClases('primario', 'self-start disabled:cursor-wait')}
      >
        {pendiente ? 'Publicando…' : 'Publicar aviso'}
      </button>
    </form>
  )
}
