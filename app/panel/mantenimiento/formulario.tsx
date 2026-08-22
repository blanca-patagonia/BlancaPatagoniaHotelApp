'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearOrden, type EstadoOrden } from './actions'
import {
  CAMPO,
  Campo,
  ExitoConPasos,
  Mensaje,
  PieDeFormulario,
  botonClases,
} from '../_components/ui'

const ESTADO_INICIAL: EstadoOrden = {}

/**
 * Alta de una orden de trabajo.
 *
 * La prioridad no es decorativa: una orden de prioridad alta sobre una unidad
 * ocupada es lo que dispara el aviso en el tablero.
 */
export function FormularioOrden({
  unidades,
  unidadInicial = '',
}: {
  unidades: { id: string; nombre: string }[]
  /**
   * Unidad preseleccionada. La manda la accion rapida de la grilla de ocupacion:
   * sin esto, quien reporta un desperfecto desde la grilla tenia que volver a
   * buscar la habitacion en el desplegable, y la accion no ahorraba nada.
   */
  unidadInicial?: string
}) {
  const [estado, accion, pendiente] = useActionState(crearOrden, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
      <Campo etiqueta="¿Qué hay que arreglar?" requerido anchoCompleto>
        <input
          name="titulo"
          required
          className={CAMPO}
          placeholder="Pérdida de agua en el baño"
        />
      </Campo>

      <Campo etiqueta="Unidad afectada" ayuda="Dejalo en general si no es de una habitación puntual.">
        <select name="unidad_id" defaultValue={unidadInicial} className={CAMPO}>
          <option value="">Sin unidad / general</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Prioridad" ayuda="Alta significa que impide usar la habitación.">
        <select name="prioridad" defaultValue="media" className={CAMPO}>
          <option value="baja">Baja</option>
          <option value="media">Media</option>
          <option value="alta">Alta</option>
        </select>
      </Campo>

      <Campo etiqueta="Detalle" ayuda="Lo que necesita saber quien lo va a resolver." anchoCompleto>
        <textarea name="descripcion" rows={4} className={CAMPO} />
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
              { href: '/panel/mantenimiento/nueva', texto: 'Cargar otra' },
              { href: '/panel/mantenimiento', texto: 'Volver al listado' },
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
          {pendiente ? 'Guardando…' : 'Crear la orden'}
        </button>
        <Link href="/panel/mantenimiento" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
