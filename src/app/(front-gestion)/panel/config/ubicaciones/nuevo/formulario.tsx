'use client'

import { useActionState } from 'react'
import { crearUnidad, type EstadoAltaUnidad } from '../../unidades.actions'
import { CAMPO, Campo, Mensaje } from '../../../_components/ui'
import { BotonEnvio } from '../../../_components/boton-envio'

const INICIAL: EstadoAltaUnidad = {}

/** Alta de una habitación o cabaña física. Un error no vacía el formulario. */
export function FormularioUnidad({ tipos }: { tipos: { id: string; nombre: string }[] }) {
  const [estado, accion] = useActionState(crearUnidad, INICIAL)
  const v = estado.valores

  return (
    <form action={accion} className="grid gap-4 sm:grid-cols-2">
      {estado.error && (
        <div className="sm:col-span-2">
          <Mensaje tono="error">{estado.error}</Mensaje>
        </div>
      )}
      <Campo
        etiqueta="Nombre"
        ayuda="Como la conoce el personal: «Hab. 12», «Cabaña Onelli»."
        requerido
      >
        <input
          name="nombre"
          required
          defaultValue={v?.nombre ?? ''}
          placeholder="Cabaña 7"
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Tipo de alojamiento" requerido>
        <select
          key={v?.tipo_unidad_id ?? ''}
          name="tipo_unidad_id"
          required
          defaultValue={v?.tipo_unidad_id ?? ''}
          className={CAMPO}
        >
          <option value="" disabled>
            Elegir…
          </option>
          {tipos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
      </Campo>
      <div className="sm:col-span-2">
        <BotonEnvio cargando="Creando…" extra="w-full sm:w-auto">
          Crear unidad
        </BotonEnvio>
      </div>
    </form>
  )
}
