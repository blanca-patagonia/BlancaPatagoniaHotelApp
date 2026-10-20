'use client'

import { useActionState } from 'react'
import { CATEGORIAS_UNIDAD, ETIQUETAS_CATEGORIA } from '@/lib/domain/unidades'
import { crearTipoUnidad, type EstadoAltaTipo } from '../../actions'
import { CAMPO, Campo, Mensaje } from '../../../_components/ui'
import { BotonEnvio } from '../../../_components/boton-envio'

const INICIAL: EstadoAltaTipo = {}

/**
 * Alta de un tipo de alojamiento. Si el servidor rechaza algo, lo cargado
 * vuelve en el estado de la acción y el formulario no se vacía.
 */
export function FormularioTipo() {
  const [estado, accion] = useActionState(crearTipoUnidad, INICIAL)
  const v = estado.valores

  return (
    <form action={accion} className="grid gap-4 sm:grid-cols-2">
      {estado.error && (
        <div className="sm:col-span-2">
          <Mensaje tono="error">{estado.error}</Mensaje>
        </div>
      )}
      <Campo
        etiqueta="Código"
        ayuda="Mayúsculas, números y guiones. No se puede cambiar después."
        requerido
      >
        <input
          name="codigo"
          required
          defaultValue={v?.codigo ?? ''}
          placeholder="HOST-DELUXE"
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Nombre" requerido>
        <input
          name="nombre"
          required
          defaultValue={v?.nombre ?? ''}
          placeholder="Deluxe"
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Categoría" requerido>
        <select name="categoria" required defaultValue={v?.categoria ?? ''} className={CAMPO}>
          <option value="" disabled>
            Elegir…
          </option>
          {CATEGORIAS_UNIDAD.map((c) => (
            <option key={c} value={c}>
              {ETIQUETAS_CATEGORIA[c]}
            </option>
          ))}
        </select>
      </Campo>
      <Campo etiqueta="Capacidad máxima" requerido>
        <input
          name="capacidad_max"
          type="number"
          min={1}
          required
          defaultValue={v?.capacidad ?? '2'}
          className={CAMPO}
        />
      </Campo>
      <div className="sm:col-span-2">
        <Campo etiqueta="Descripción" ayuda="Es la que ve el huésped en el catálogo de la web.">
          <input
            name="descripcion"
            defaultValue={v?.descripcion ?? ''}
            placeholder="Para el catálogo público"
            className={CAMPO}
          />
        </Campo>
      </div>
      <div className="sm:col-span-2">
        <BotonEnvio cargando="Creando…" extra="w-full sm:w-auto">
          Crear tipo
        </BotonEnvio>
      </div>
    </form>
  )
}
