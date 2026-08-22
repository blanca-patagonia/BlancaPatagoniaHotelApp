'use client'

import { useActionState } from 'react'
import { cargarManual, type EstadoCargo } from './actions'
import { ETIQUETAS_FOLIO, FOLIOS } from '@/lib/domain/folios'
import { MONEDAS_EXTRANJERAS, ETIQUETAS_MONEDA } from '@/lib/domain/divisas'
import { CAMPO, Campo, Mensaje, botonClases } from '../../../_components/ui'

const ESTADO_INICIAL: EstadoCargo = {}

export interface OpcionDepartamento {
  id: string
  etiqueta: string
}

/**
 * Cargo manual a la cuenta.
 *
 * Es lo que WinPAX llamaba «cargar consumos manuales por departamento y
 * subdepartamento, en distintas monedas». Las tres partes importan:
 *
 * · **Departamento**: para que el cargo aparezca agrupado donde corresponde y no
 *   en «Otros».
 * · **Folio**: para poder mandarlo directo a la cuenta de la empresa sin cargarlo
 *   primero al huésped y moverlo después.
 * · **Moneda**: si se cobró en pesos, se convierte y **queda registrada la
 *   cotización usada** (exigencia de trazabilidad del ADR 0003).
 */
export function CargoManual({
  reservaId,
  departamentos,
}: {
  reservaId: string
  departamentos: OpcionDepartamento[]
}) {
  const [estado, accion, pendiente] = useActionState(cargarManual, ESTADO_INICIAL)

  return (
    <form action={accion} className="grid gap-x-4 gap-y-3 p-5 sm:grid-cols-6">
      <input type="hidden" name="reserva_id" value={reservaId} />

      <div className="sm:col-span-3">
        <Campo etiqueta="Concepto" requerido>
          <input
            name="concepto"
            required
            placeholder="Lavandería, llamada telefónica, rotura…"
            className={CAMPO}
          />
        </Campo>
      </div>

      <div className="sm:col-span-3">
        <Campo etiqueta="Departamento" ayuda="Define dónde aparece el cargo en la cuenta.">
          <select name="departamento_id" defaultValue="" className={CAMPO}>
            <option value="">Sin clasificar (va a «Otros»)</option>
            {departamentos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <div className="sm:col-span-2">
        <Campo etiqueta="Folio">
          <select name="folio" defaultValue="A" className={CAMPO}>
            {FOLIOS.map((f) => (
              <option key={f} value={f}>
                {ETIQUETAS_FOLIO[f]}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <Campo etiqueta="Moneda" ayuda="Si no es USD, se convierte y queda la cotización.">
        <select name="moneda" defaultValue="USD" className={CAMPO}>
          <option value="USD">USD — Dólar</option>
          {MONEDAS_EXTRANJERAS.map((m) => (
            <option key={m} value={m}>
              {m} — {ETIQUETAS_MONEDA[m]}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Importe" requerido>
        <input name="importe" type="number" min="0.01" step="0.01" required className={CAMPO} />
      </Campo>

      <Campo etiqueta="Cantidad">
        <input name="cantidad" type="number" min="1" defaultValue={1} className={CAMPO} />
      </Campo>

      <div className="sm:col-span-3">
        <Campo etiqueta="Comprobante" ayuda="Ticket, voucher o número externo, si hay.">
          <input name="comprobante" className={CAMPO} />
        </Campo>
      </div>

      {estado.error && (
        <div className="sm:col-span-6">
          <Mensaje tono="error">{estado.error}</Mensaje>
        </div>
      )}
      {estado.ok && (
        <div className="sm:col-span-6">
          <Mensaje tono="ok">{estado.ok}</Mensaje>
        </div>
      )}

      <div className="sm:col-span-6">
        <button
          type="submit"
          disabled={pendiente}
          className={botonClases('secundario', 'w-full disabled:cursor-wait sm:w-auto')}
        >
          {pendiente ? 'Cargando…' : 'Agregar cargo'}
        </button>
      </div>
    </form>
  )
}
