'use client'

import { useActionState } from 'react'
import { guardarAjustes, type EstadoAjustes } from './actions'
import { CAMPO, Campo, botonClases } from '../../_components/ui'
import { DIAS_SEMANA, type CanalBandeja } from '@/lib/domain/bandeja'
import type { AjustesDeFila } from '@/lib/bandeja/consultas'

/**
 * Ajustes de un canal: saludo, fuera de horario y asignación automática
 * (en Chatwoot, la pestaña «Configuración» de cada bandeja).
 *
 * Todo a la vista, sin secciones plegadas: cada interruptor tiene al lado el
 * texto que controla.
 */
export function FormAjustes({ canal, ajustes }: { canal: CanalBandeja; ajustes: AjustesDeFila }) {
  const [estado, accion, guardando] = useActionState<EstadoAjustes, FormData>(guardarAjustes, {})
  const hora = (h: string) => h.slice(0, 5)

  return (
    <form action={accion} className="grid gap-5">
      <input type="hidden" name="canal" value={canal} />

      <label className="flex items-start gap-3">
        <input type="checkbox" name="activa" defaultChecked={ajustes.activa} className="mt-1 size-4" />
        <span>
          <span className="block text-sm font-medium text-stone-800">Canal activo</span>
          <span className="block text-xs text-stone-600">Apagado, los mensajes nuevos de este canal no entran. El historial se conserva.</span>
        </span>
      </label>

      <>
          <fieldset className="grid gap-2 rounded-xl border border-stone-200 p-4">
            <legend className="px-1 text-sm font-semibold text-stone-800">Saludo automático</legend>
            <label className="flex items-start gap-3">
              <input type="checkbox" name="saludo_activo" defaultChecked={ajustes.saludo_activo} className="mt-1 size-4" />
              <span className="text-sm text-stone-700">Saludar a quien escribe por primera vez</span>
            </label>
            <Campo etiqueta="Texto del saludo" ayuda="Podés usar {{nombre}} para el primer nombre. Si no se conoce, se omite.">
              <textarea name="saludo_mensaje" rows={2} maxLength={1000} defaultValue={ajustes.saludo_mensaje} className={CAMPO} />
            </Campo>
          </fieldset>

          <fieldset className="grid gap-3 rounded-xl border border-stone-200 p-4">
            <legend className="px-1 text-sm font-semibold text-stone-800">Fuera de horario</legend>
            <label className="flex items-start gap-3">
              <input type="checkbox" name="fuera_horario_activo" defaultChecked={ajustes.fuera_horario_activo} className="mt-1 size-4" />
              <span className="text-sm text-stone-700">Avisar cuando escriben fuera del horario de atención</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Atendemos desde">
                <input type="time" name="horario_desde" defaultValue={hora(ajustes.horario_desde)} className={CAMPO} />
              </Campo>
              <Campo etiqueta="Hasta">
                <input type="time" name="horario_hasta" defaultValue={hora(ajustes.horario_hasta)} className={CAMPO} />
              </Campo>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-stone-700">Días de atención</legend>
              <div className="flex flex-wrap gap-2">
                {DIAS_SEMANA.map((d) => (
                  <label key={d.n} className="toque inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-stone-200 has-[:checked]:bg-lago-50 has-[:checked]:ring-lago-300">
                    <input type="checkbox" name="dias" value={d.n} defaultChecked={ajustes.dias_atencion.includes(d.n)} className="size-4" />
                    <span title={d.largo}>{d.corto}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-stone-500">Es la hora de El Calafate. Si «hasta» es anterior a «desde», el horario cruza la medianoche.</p>
            </fieldset>
            <Campo etiqueta="Mensaje fuera de horario" ayuda="Sale una vez por conversación nueva. Reemplaza al saludo cuando corresponden los dos.">
              <textarea name="fuera_horario_mensaje" rows={2} maxLength={1000} defaultValue={ajustes.fuera_horario_mensaje} className={CAMPO} />
            </Campo>
          </fieldset>
      </>

      <label className="flex items-start gap-3">
        <input type="checkbox" name="asignacion_automatica" defaultChecked={ajustes.asignacion_automatica} className="mt-1 size-4" />
        <span>
          <span className="block text-sm font-medium text-stone-800">Asignar cada conversación nueva automáticamente</span>
          <span className="block text-xs text-stone-600">
            A quien de recepción tenga menos conversaciones abiertas. El sistema no sabe quién está en turno: conviene sólo si el turno es siempre de las mismas personas.
          </span>
        </span>
      </label>

      {estado.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {estado.error}
        </p>
      )}
      {estado.ok && !guardando && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          Ajustes guardados.
        </p>
      )}
      <div>
        <button type="submit" disabled={guardando} className={botonClases('primario', 'w-full sm:w-auto')}>
          {guardando ? 'Guardando…' : 'Guardar ajustes'}
        </button>
      </div>
    </form>
  )
}
