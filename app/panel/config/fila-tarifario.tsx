'use client'

import { useActionState, useState } from 'react'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import { actualizarTarifasDeFila, type EstadoTarifasFila } from './actions'
import { BotonEnvio } from '../_components/boton-envio'
import { TD, botonClases } from '../_components/ui'
import { formatearUSD } from '@/lib/domain/moneda'

const ORDEN_TEMP = ['baja', 'media', 'alta'] as const
type Temporada = (typeof ORDEN_TEMP)[number]

const ETIQUETAS_TEMP: Record<Temporada, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
}

export interface PrecioTemporada {
  id: string
  neto: number
  rack: number
}

const ESTADO_INICIAL: EstadoTarifasFila = {}

/**
 * Una fila del tarifario, con vista de lectura prolija y edición aparte.
 *
 * Patrón de referencia: Reservation 360 de Hotel PMS para el criterio de
 * «mostrar el dato, no el formulario». La primera vuelta de esta pantalla
 * juntó las tres temporadas en un solo `<form>` con seis campos siempre
 * visibles — mejor que el «OK» por celda de antes, pero seguía siendo una
 * pared de números apenas se miraban las diez filas juntas. Acá el precio
 * se lee como precio (una tarjeta clara por temporada, el rack destacado
 * porque es el que paga la mayoría) y los campos aparecen recién al
 * apretar «Editar precios» — un botón, no un `<details>`: la fila entera
 * sigue en el DOM y el estado es explícito (`useState`), nada se esconde
 * con CSS ni con una URL.
 */
export function FilaTarifario({
  nombre,
  categoria,
  cap,
  precios,
}: {
  nombre: string
  categoria: CategoriaUnidad
  cap: number
  /** Solo las temporadas que este tipo tiene cargadas. */
  precios: Partial<Record<Temporada, PrecioTemporada>>
}) {
  const [editando, setEditando] = useState(false)
  const [estado, accion, pendiente] = useActionState(actualizarTarifasDeFila, ESTADO_INICIAL)

  /*
    Guardado bien → se vuelve a la vista de lectura sola, para que se vea el
    precio ya actualizado y no el formulario que lo cambió. Un error se queda
    en edición: es donde hay que corregir el número.

    Ajustar estado a partir de otro estado que cambió es el caso que React
    documenta resolver comparando en el cuerpo del render, no con un
    `useEffect` — un `setState` síncrono ahí encadena una vuelta de render de
    más sin necesidad (`react-hooks/set-state-in-effect`).
  */
  const [estadoPrevio, setEstadoPrevio] = useState(estado)
  if (estado !== estadoPrevio) {
    setEstadoPrevio(estado)
    if (estado.ok) setEditando(false)
  }

  return (
    <tr className="border-t border-stone-100 align-top">
      <td className={TD}>
        <span className="font-medium text-stone-800">{nombre}</span>
        <span className="ml-2 text-xs text-stone-600">{ETIQUETAS_CATEGORIA[categoria]}</span>
      </td>
      <td className={`${TD} tabular text-stone-600`}>{cap}</td>

      <td colSpan={ORDEN_TEMP.length + 1} className={TD}>
        {editando ? (
          <form action={accion} className="flex flex-wrap items-end gap-4">
            {ORDEN_TEMP.map((t) => {
              const p = precios[t]
              if (!p) {
                return (
                  <span key={t} className="text-sm text-stone-300">
                    Temporada {ETIQUETAS_TEMP[t].toLowerCase()}: —
                  </span>
                )
              }
              return (
                <div key={t} className="flex items-end gap-2 rounded-lg bg-stone-50 p-2">
                  <input type="hidden" name={`tarifa_id_${t}`} value={p.id} />
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-stone-500">Temporada {ETIQUETAS_TEMP[t].toLowerCase()} · Neto</span>
                    <input
                      type="number"
                      name={`precio_neto_${t}`}
                      defaultValue={p.neto}
                      min="0"
                      step="1"
                      className="tabular w-20 rounded-md border border-stone-300 px-2 py-1.5 text-right text-sm focus:border-lago-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-stone-500">Rack</span>
                    <input
                      type="number"
                      name={`precio_rack_${t}`}
                      defaultValue={p.rack}
                      min="0"
                      step="1"
                      className="tabular w-20 rounded-md border border-stone-300 px-2 py-1.5 text-right text-sm focus:border-lago-500 focus:outline-none"
                    />
                  </label>
                </div>
              )
            })}

            <div className="flex items-center gap-2">
              <BotonEnvio variante="secundario" cargando="Guardando…">
                Guardar
              </BotonEnvio>
              <button
                type="button"
                onClick={() => setEditando(false)}
                className={botonClases('fantasma')}
              >
                Cancelar
              </button>
            </div>

            {estado.error && <span className="text-sm text-red-700">{estado.error}</span>}
            {estado.ok && !pendiente && <span className="text-sm text-emerald-700">✓ {estado.ok}</span>}
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {ORDEN_TEMP.map((t) => {
              const p = precios[t]
              return (
                <div
                  key={t}
                  className="rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-200"
                >
                  <p className="text-xs font-medium text-stone-500">Temporada {ETIQUETAS_TEMP[t].toLowerCase()}</p>
                  {p ? (
                    <p className="tabular text-sm text-stone-800">
                      <span className="font-semibold text-stone-900">{formatearUSD(p.rack)}</span>
                      <span className="text-stone-500"> rack · {formatearUSD(p.neto)} neto</span>
                    </p>
                  ) : (
                    <p className="text-sm text-stone-300">Sin tarifa</p>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => setEditando(true)}
              className={botonClases('secundario')}
            >
              Editar precios
            </button>
            {estado.ok && <span className="text-sm text-emerald-700">✓ {estado.ok}</span>}
          </div>
        )}
      </td>
    </tr>
  )
}
