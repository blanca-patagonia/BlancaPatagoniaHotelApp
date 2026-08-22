'use client'

import { useActionState } from 'react'
import { importarResenasCanal, type EstadoImportacionResenas } from './actions'
import { CAMPO, Campo, Mensaje, botonClases } from '../_components/ui'

const ESTADO_INICIAL: EstadoImportacionResenas = {}

/**
 * Importación del export de reseñas del extranet.
 *
 * ── Por qué esto existía como formulario manual y no como importador ────────
 *
 * `canal_resenas` tenía las columnas correctas y ningún camino de ingesta: solo un
 * formulario que escribía cinco campos, así que el número de reseña, el país, el
 * título y —lo importante— el vínculo con la reserva nunca se llenaban.
 *
 * La Reviews API de Booking es de partner, así que el export del extranet es el único
 * camino disponible. Y alcanza: trae puntaje, texto, fecha, y a veces el número de
 * reserva, que es lo que permite ligarlas solas.
 */
export function ImportarResenas() {
  const [estado, accion, pendiente] = useActionState(importarResenasCanal, ESTADO_INICIAL)

  return (
    <form action={accion} className="flex flex-col gap-3 p-5">
      <p className="text-sm text-stone-600">
        En el extranet de Booking, en la sección de <strong>Reseñas</strong>, hay un botón para
        descargarlas. Subí ese archivo acá.
      </p>

      <Campo
        etiqueta="Archivo de reseñas"
        ayuda="Las que traigan el número de reserva quedan ligadas solas. Las demás se pueden ligar en un clic desde la lista."
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

      {estado.sinLigar != null && (
        /*
          No se presenta como error: una reseña sin ligar es un dato válido y útil, y
          ligarla mal seria peor. Se dice cuántas quedaron para que alguien las resuelva.
        */
        <div className="rounded-lg bg-lenga-50 px-4 py-3 text-sm text-lenga-900 ring-1 ring-lenga-200">
          <strong className="font-semibold">{estado.sinLigar}</strong> quedaron sin ligar a una
          reserva, porque el archivo no traía el número o había más de una reserva posible. Cada una
          dice su motivo en la lista, y se ligan eligiendo la reserva.
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
        </div>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className={botonClases('primario', 'w-full self-start disabled:cursor-wait sm:w-auto')}
      >
        {pendiente ? 'Leyendo el archivo…' : 'Subir reseñas'}
      </button>
    </form>
  )
}
