'use client'

import { useActionState } from 'react'
import { crearPromocion, type EstadoAltaPromocion } from '../../promociones.actions'
import { CAMPO, Campo, Mensaje } from '../../../_components/ui'
import { BotonEnvio } from '../../../_components/boton-envio'

const INICIAL: EstadoAltaPromocion = {}

/** Alta de una promoción. Un error no vacía el formulario. */
export function FormularioPromocion() {
  const [estado, accion] = useActionState(crearPromocion, INICIAL)
  const v = estado.valores ?? {}

  return (
    <form action={accion} className="grid gap-4 sm:grid-cols-2">
      {estado.error && (
        <div className="sm:col-span-2">
          <Mensaje tono="error">{estado.error}</Mensaje>
        </div>
      )}
      <Campo
        etiqueta="Código"
        ayuda="El cupón que se comunica. Mayúsculas, números y guiones; no se cambia después."
        requerido
      >
        <input
          name="codigo"
          required
          defaultValue={v.codigo ?? ''}
          placeholder="VERANO2026"
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Nombre" requerido>
        <input
          name="nombre"
          required
          defaultValue={v.nombre ?? ''}
          placeholder="Verano anticipado"
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Tipo" requerido>
        <select key={v.tipo ?? ''} name="tipo" required defaultValue={v.tipo ?? ''} className={CAMPO}>
          <option value="" disabled>
            Elegir…
          </option>
          <option value="porcentaje">% sobre el neto</option>
          <option value="monto">Monto fijo (USD)</option>
        </select>
      </Campo>
      <Campo etiqueta="Valor" requerido>
        <input
          name="valor"
          type="number"
          min={0.01}
          step="0.01"
          required
          defaultValue={v.valor ?? ''}
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Noches mínimas" ayuda="Opcional.">
        <input
          name="min_noches"
          type="number"
          min={0}
          defaultValue={v.min_noches ?? ''}
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Anticipación mínima (días)" ayuda="Opcional.">
        <input
          name="anticipacion_dias"
          type="number"
          min={0}
          defaultValue={v.anticipacion_dias ?? ''}
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Vigente desde" ayuda="Opcional.">
        <input
          name="vigencia_desde"
          type="date"
          defaultValue={v.vigencia_desde ?? ''}
          className={CAMPO}
        />
      </Campo>
      <Campo etiqueta="Vigente hasta" ayuda="Opcional.">
        <input
          name="vigencia_hasta"
          type="date"
          defaultValue={v.vigencia_hasta ?? ''}
          className={CAMPO}
        />
      </Campo>
      <div className="sm:col-span-2">
        <BotonEnvio cargando="Creando…" extra="w-full sm:w-auto">
          Crear promoción
        </BotonEnvio>
      </div>
    </form>
  )
}
