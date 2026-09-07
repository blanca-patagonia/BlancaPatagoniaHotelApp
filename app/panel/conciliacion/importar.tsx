'use client'

import { useActionState } from 'react'
import {
  importarExtracto,
  traerLiquidacionMercadoPago,
  type EstadoImportacionExtracto,
  type EstadoTraerLiquidacion,
} from './actions'
import { CAMPO, Campo, Mensaje, botonClases } from '../_components/ui'

const ESTADO_EXTRACTO: EstadoImportacionExtracto = {}
const ESTADO_LIQUIDACION: EstadoTraerLiquidacion = {}

/**
 * Subida del extracto bancario.
 *
 * Devuelve estado y no redirige por lo mismo que la importación del informe de
 * Booking: el resultado es detallado —cuántos entraron, cuántos ya estaban,
 * cuántos se conciliaron solos y qué líneas quedaron afuera— y eso no cabe en un
 * `?ok=` de la URL.
 */
export function ImportarExtracto({ monedas }: { monedas: readonly string[] }) {
  const [estado, accion, pendiente] = useActionState(importarExtracto, ESTADO_EXTRACTO)

  return (
    <form action={accion} className="flex flex-col gap-3 p-5">
      <p className="text-sm text-stone-600">
        En el Home Banking: <strong>Consultas → Movimientos → Exportar</strong>, en formato CSV.
        Subirlo dos veces no duplica nada: el sistema reconoce los movimientos que ya tenía.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo
          etiqueta="Archivo del extracto"
          ayuda="CSV exportado del Home Banking."
        >
          <input
            type="file"
            name="archivo"
            accept=".csv,text/csv,text/plain"
            required
            className={CAMPO}
          />
        </Campo>

        {/*
          La moneda la elige quien importa, y no se deduce del archivo.

          El extracto de una caja de ahorro en pesos y el de una en dólares son
          idénticos salvo por el encabezado del banco. Adivinarla mal sumaría
          dólares como pesos en el resumen del mes.
        */}
        <Campo etiqueta="Moneda de la cuenta" ayuda="El archivo no la dice: elegila vos.">
          <select name="moneda" defaultValue="ARS" className={CAMPO}>
            {monedas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Campo>

        <Campo etiqueta="Cuenta" ayuda="Opcional. Para distinguirla si el hotel tiene más de una.">
          <input name="cuenta" maxLength={60} placeholder="Cuenta corriente $" className={CAMPO} />
        </Campo>
      </div>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && <Mensaje tono="ok">{estado.ok}</Mensaje>}

      {estado.advertencia && (
        <div className="rounded-lg bg-lenga-50 px-4 py-3 text-sm text-lenga-900 ring-1 ring-lenga-200">
          <strong className="font-semibold">Atención:</strong> {estado.advertencia}
        </div>
      )}

      {estado.descartadas && estado.descartadas.length > 0 && (
        <div className="rounded-lg bg-stone-50 px-4 py-3 text-sm ring-1 ring-stone-200">
          <p className="font-semibold text-stone-800">
            Filas que no se leyeron ({estado.descartadas.length}):
          </p>
          <ul className="mt-2 space-y-1 text-stone-700">
            {estado.descartadas.map((d) => (
              <li key={d.fila}>
                <span className="font-medium">Fila {d.fila}:</span> {d.motivo}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">
            Los títulos del principio y la fila de saldo del final del extracto caen acá, y es lo
            esperado. La fila se cuenta desde el principio del archivo, sin contar las líneas en
            blanco.
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className={botonClases('primario', 'w-full self-start disabled:cursor-wait sm:w-auto')}
      >
        {pendiente ? 'Leyendo el archivo…' : 'Subir extracto'}
      </button>
    </form>
  )
}

/**
 * Traída del reporte de liquidaciones de MercadoPago.
 *
 * La generación del reporte del otro lado es asincrónica: la primera vez el
 * sistema se lo pide a MercadoPago y hay que volver en unos minutos. Eso se dice
 * en el mensaje que devuelve la acción, no se esconde detrás de un spinner que
 * gira para siempre.
 */
export function TraerMercadoPago({ desde, hasta }: { desde: string; hasta: string }) {
  const [estado, accion, pendiente] = useActionState(
    traerLiquidacionMercadoPago,
    ESTADO_LIQUIDACION,
  )

  return (
    <form action={accion} className="flex flex-col gap-3 p-5">
      <p className="text-sm text-stone-600">
        Trae lo que MercadoPago <strong>acreditó de verdad</strong>, ya descontada su comisión —que
        no es lo mismo que lo que cobró—. Usa el mismo token que el cobro en línea.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Desde">
          <input type="date" name="desde" defaultValue={desde} required className={CAMPO} />
        </Campo>
        <Campo etiqueta="Hasta">
          <input type="date" name="hasta" defaultValue={hasta} required className={CAMPO} />
        </Campo>
      </div>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && <Mensaje tono="ok">{estado.ok}</Mensaje>}

      <button
        type="submit"
        disabled={pendiente}
        className={botonClases('secundario', 'w-full self-start disabled:cursor-wait sm:w-auto')}
      >
        {pendiente ? 'Consultando a MercadoPago…' : 'Traer de MercadoPago'}
      </button>
    </form>
  )
}
