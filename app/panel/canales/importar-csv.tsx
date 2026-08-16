'use client'

import { useActionState } from 'react'
import { importarCsvCanal, type EstadoImportacionCsv } from './actions'
import { CAMPO, Campo, Mensaje, botonClases } from '../_components/ui'

const ESTADO_INICIAL: EstadoImportacionCsv = {}

/**
 * Importación del «Informe de reservas» del extranet de Booking.
 *
 * ── Por qué devuelve estado y no redirige ───────────────────────────────────
 *
 * El resultado de leer un archivo ajeno es **detallado**: si trae 40 reservas y
 * entraron 38, hay que poder ver las dos que faltan, con su número de fila y el
 * motivo. Eso no cabe en un `?error=` de la URL, y resumirlo a «hubo errores»
 * deja a quien importa sin nada que corregir.
 *
 * ── Las dos advertencias ────────────────────────────────────────────────────
 *
 * · **Filas rechazadas**: se listan una por una, con el número que se ve al abrir
 *   el archivo en Excel.
 * · **Fechas ambiguas**: `10/09/2026` es el 10 de septiembre o el 9 de octubre, y
 *   no se puede resolver mirando el archivo. Se asume día/mes y se avisa, porque
 *   una reserva en la fecha equivocada no la detecta nadie hasta que el huésped
 *   aparece en la puerta.
 */
export function ImportarCsv() {
  const [estado, accion, pendiente] = useActionState(importarCsvCanal, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-col gap-3 p-5">
      <p className="text-sm text-stone-600">
        En el extranet de Booking: <strong>Administración → Informe de reservas</strong>. Descargalo
        como CSV y subilo acá sin modificarlo — si se abre y se guarda en Excel, las fechas y los
        importes pueden cambiar de formato.
      </p>

      <Campo
        etiqueta="Archivo del informe"
        ayuda="CSV descargado del extranet. Las reservas quedan en la lista de abajo para revisar antes de importarlas."
      >
        <input
          type="file"
          name="archivo"
          accept=".csv,text/csv,text/plain"
          required
          className={CAMPO}
        />
      </Campo>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && <Mensaje tono="ok">{estado.ok}</Mensaje>}

      {estado.advertencia && (
        <div className="rounded-lg bg-lenga-50 px-4 py-3 text-sm text-lenga-900 ring-1 ring-lenga-200">
          <strong className="font-semibold">Atención:</strong> {estado.advertencia}
        </div>
      )}

      {estado.rechazadas && estado.rechazadas.length > 0 && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm ring-1 ring-red-200">
          <p className="font-semibold text-red-900">
            Filas que no se pudieron leer ({estado.rechazadas.length}):
          </p>
          <ul className="mt-2 space-y-1 text-red-800">
            {estado.rechazadas.map((r) => (
              <li key={r.fila}>
                <span className="font-medium">Fila {r.fila}:</span> {r.motivos.join(' ')}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-700">
            El número de fila es el que se ve al abrir el archivo en Excel. El resto de las
            reservas sí se importó.
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className={botonClases('primario', 'w-full self-start disabled:cursor-wait sm:w-auto')}
      >
        {pendiente ? 'Leyendo el archivo…' : 'Subir informe'}
      </button>
    </form>
  )
}
