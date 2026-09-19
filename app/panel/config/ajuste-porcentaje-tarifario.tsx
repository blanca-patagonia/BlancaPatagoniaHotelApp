'use client'

import { useActionState, useState } from 'react'
import { aplicarPorcentajeTarifario, type EstadoPorcentajeTarifario } from './actions'
import { CAMPO, Campo } from '../_components/ui'
import { BotonEnvio } from '../_components/boton-envio'
import { useConfirmar } from '../_components/confirmar'

const ESTADO_INICIAL: EstadoPorcentajeTarifario = {}

/**
 * Sube o baja todas las tarifas un mismo porcentaje de una vez, como se hace
 * en un hotel real al cambio de temporada — en vez de entrar tarifa por
 * tarifa. Se aplica sobre precio neto y rack por igual, así la relación
 * entre los dos (el neto de agencia nunca supera al rack de mostrador) se
 * mantiene sola.
 */
export function AjustePorcentajeTarifario() {
  const [estado, accion] = useActionState(aplicarPorcentajeTarifario, ESTADO_INICIAL)
  const [porcentaje, setPorcentaje] = useState('')
  const pedirConfirmacion = useConfirmar()

  return (
    <form
      action={accion}
      onSubmit={(e) => {
        const n = Number(porcentaje)
        if (!Number.isFinite(n) || n === 0) return // el `required` del campo ya lo frena; nada que confirmar
        // El modal propio no puede bloquear el hilo como `window.confirm`: se
        // corta el envío SIEMPRE y se reintenta con `requestSubmit()` si la
        // respuesta es que sí (ver el comentario de `confirmar.tsx`).
        e.preventDefault()
        const formulario = e.currentTarget
        const verbo = n > 0 ? 'subir' : 'bajar'
        const texto =
          `¿Confirmás ${verbo} un ${Math.abs(n)}% el precio neto y rack de las tarifas elegidas? ` +
          'No hay un "deshacer" automático — quedaría otro ajuste por porcentaje, en sentido contrario.'
        void pedirConfirmacion(texto).then((ok) => {
          if (ok) formulario.requestSubmit()
        })
      }}
      className="grid gap-3 p-5 sm:grid-cols-4 sm:items-end"
    >
      <Campo etiqueta="Porcentaje" requerido ayuda="Positivo para subir, negativo para bajar. Ej: 10 o -5.">
        <input
          name="porcentaje"
          type="number"
          step="0.1"
          required
          value={porcentaje}
          onChange={(e) => setPorcentaje(e.target.value)}
          className={CAMPO}
          placeholder="10"
        />
      </Campo>
      <Campo etiqueta="Aplicar a">
        <select name="temporada" defaultValue="" className={CAMPO}>
          <option value="">Todas las temporadas</option>
          <option value="baja">Solo temporada baja</option>
          <option value="media">Solo temporada media</option>
          <option value="alta">Solo temporada alta</option>
        </select>
      </Campo>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <BotonEnvio variante="secundario" cargando="Aplicando…" extra="w-full sm:w-auto">
          Aplicar porcentaje
        </BotonEnvio>
        {estado.error && <p className="text-sm text-red-700">{estado.error}</p>}
        {estado.ok && <p className="text-sm text-emerald-700">✓ {estado.ok}</p>}
      </div>
    </form>
  )
}
