'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearObjeto, type EstadoObjeto } from './actions'
import {
  CAMPO,
  Campo,
  ExitoConPasos,
  Mensaje,
  PieDeFormulario,
  botonClases,
} from '../_components/ui'

const ESTADO_INICIAL: EstadoObjeto = {}

/**
 * Alta de un objeto olvidado por un huésped.
 *
 * Lo carga quien lo encuentra —normalmente mucamas, desde el teléfono, mientras
 * limpia—, así que el formulario es corto a propósito: descripción y lugar. La
 * fecha la pone la base.
 */
export function FormularioObjeto() {
  const [estado, accion, pendiente] = useActionState(crearObjeto, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      <Campo
        etiqueta="¿Qué se encontró?"
        requerido
        ayuda="Describilo como para reconocerlo si alguien lo reclama."
      >
        <input name="descripcion" required className={CAMPO} placeholder="Campera azul de abrigo" />
      </Campo>

      <Campo etiqueta="¿Dónde estaba?">
        <input name="ubicacion" className={CAMPO} placeholder="Habitación 203, comedor…" />
      </Campo>

      {estado.error && (
        <div className="sm:col-span-2">
          <Mensaje tono="error">{estado.error}</Mensaje>
        </div>
      )}
      {estado.ok && (
        <div className="sm:col-span-2">
          <ExitoConPasos
            mensaje={estado.ok}
            pasos={[
              { href: '/panel/objetos-perdidos/nuevo', texto: 'Registrar otro' },
              { href: '/panel/objetos-perdidos', texto: 'Volver al listado' },
            ]}
          />
        </div>
      )}

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('primario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Guardando…' : 'Registrar objeto'}
        </button>
        <Link
          href="/panel/objetos-perdidos"
          className={botonClases('secundario', 'w-full sm:w-auto')}
        >
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
