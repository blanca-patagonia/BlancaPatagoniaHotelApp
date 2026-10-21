'use client'

import { useActionState, useState } from 'react'
import { guardarPlantilla, restaurarPlantillaOriginal, type EstadoPlantilla } from './plantillas-actions'
import { BotonEnvio } from '../_components/boton-envio'
import { CAMPO, Campo, Etiqueta, botonClases } from '../_components/ui'

const ESTADO_INICIAL: EstadoPlantilla = {}

interface Props {
  evento: string
  /** Texto ORIGINAL sin resolver (con `{{marcadores}}`), no la vista con datos de muestra. */
  asuntoFuente: string
  cuerpoFuente: string
  /** `true` cuando esta plantilla tiene un override guardado en `plantillas_email`. */
  editada: boolean
  puedeEditar: boolean
}

/**
 * Alterna entre mostrar el asunto/cuerpo (ya resueltos con datos de muestra,
 * más arriba en la tarjeta) y editar el texto original de la plantilla.
 *
 * Mismo patrón que `FilaTarifario`/`FilaProducto`: un botón explícito, nunca
 * un `<details>`, y el `<textarea>` trae el texto CON los `{{marcadores}}`
 * intactos — es lo que hay que poder tocar, no la versión ya rellenada que
 * se ve en la vista previa de arriba.
 */
export function PlantillaEditable({ evento, asuntoFuente, cuerpoFuente, editada, puedeEditar }: Props) {
  const [editando, setEditando] = useState(false)
  const [estado, accion, pendiente] = useActionState(guardarPlantilla, ESTADO_INICIAL)

  const [estadoPrevio, setEstadoPrevio] = useState(estado)
  if (estado !== estadoPrevio) {
    setEstadoPrevio(estado)
    if (estado.ok) setEditando(false)
  }

  if (!puedeEditar) return null

  if (!editando) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editada && <Etiqueta tono="lago">Editada</Etiqueta>}
        <button type="button" onClick={() => setEditando(true)} className={botonClases('secundario')}>
          {editada ? 'Editar de nuevo' : 'Editar plantilla'}
        </button>
        {editada && (
          <form action={restaurarPlantillaOriginal}>
            <input type="hidden" name="evento" value={evento} />
            <BotonEnvio
              variante="fantasma"
              cargando="Restaurando…"
              confirmar="¿Volver al texto original? Se pierde lo que se editó acá."
            >
              Restaurar original
            </BotonEnvio>
          </form>
        )}
      </div>
    )
  }

  return (
    <form action={accion} className="mt-3 flex flex-col gap-3 rounded-lg bg-stone-50 p-4">
      <input type="hidden" name="evento" value={evento} />
      <Campo etiqueta="Asunto" requerido ayuda="Los marcadores {{así}} se reemplazan al enviar.">
        <input name="asunto" required defaultValue={asuntoFuente} className={CAMPO} />
      </Campo>
      <Campo etiqueta="Cuerpo" requerido>
        <textarea name="cuerpo" required rows={10} defaultValue={cuerpoFuente} className={CAMPO} />
      </Campo>
      <div className="flex flex-wrap items-center gap-2">
        <BotonEnvio variante="secundario" cargando="Guardando…">
          Guardar
        </BotonEnvio>
        <button type="button" onClick={() => setEditando(false)} className={botonClases('fantasma')}>
          Cancelar
        </button>
        {estado.error && <span className="text-sm text-red-700">{estado.error}</span>}
        {estado.ok && !pendiente && <span className="text-sm text-emerald-700">✓ {estado.ok}</span>}
      </div>
    </form>
  )
}
