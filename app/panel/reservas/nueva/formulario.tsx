'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { crearReservaAction, type EstadoNuevaReserva } from '../actions'
import {
  CAMPO,
  Campo,
  Mensaje,
  PieDeFormulario,
  Tarjeta,
  botonClases,
} from '../../_components/ui'

export interface OpcionAgencia {
  id: string
  nombre: string
  descuento_pct: number
}

export interface OpcionTipo {
  tipoUnidadId: string
  nombre: string
  categoria: string
  capacidadMax: number
  disponibles: number
  total: number
  /** No hay tarifa cargada para todas las noches del rango. */
  faltanTarifas: boolean
}

const ESTADO_INICIAL: EstadoNuevaReserva = {}

export function FormularioReserva({
  opciones,
  agencias,
  checkIn,
  checkOut,
  huespedes,
  noches,
}: {
  opciones: OpcionTipo[]
  agencias: OpcionAgencia[]
  checkIn: string
  checkOut: string
  huespedes: number
  noches: number
}) {
  const [estado, accion, pendiente] = useActionState(crearReservaAction, ESTADO_INICIAL)

  // Los valores vuelven desde la acción para reponerlos si hubo error: un
  // formulario que se vacía obliga a recargar todo por corregir un campo.
  const v = estado.valores ?? {}

  const cotizables = opciones.filter((o) => !o.faltanTarifas)
  const primeraCotizable = cotizables[0]?.tipoUnidadId

  return (
    <form action={accion} className="flex flex-col gap-4">
      <input type="hidden" name="check_in" value={checkIn} />
      <input type="hidden" name="check_out" value={checkOut} />
      <input type="hidden" name="huespedes" value={huespedes} />

      {/* Si ninguna unidad tiene precio, se avisa ACÁ y no al confirmar: el
          problema es del tarifario, no de lo que cargue quien reserva. */}
      {cotizables.length === 0 && (
        <Mensaje tono="error">
          <span className="block font-medium">
            No hay tarifas cargadas para {noches === 1 ? 'esa noche' : 'esas fechas'}.
          </span>
          Hay unidades libres, pero sin precio no se puede cotizar. Cargá la temporada y sus
          precios en{' '}
          <Link href="/panel/config/temporadas" className="underline">
            Configuración → Temporadas
          </Link>
          .
        </Mensaje>
      )}

      <Tarjeta
        titulo={`2 · ¿Qué unidad?`}
        descripcion={`Precios de referencia por ${noches} ${noches === 1 ? 'noche' : 'noches'}, tarifa de mostrador.`}
      >
        <div className="flex flex-col gap-2 p-5">
          {opciones.map((o) => {
            const sinPrecio = o.faltanTarifas
            return (
              <label
                key={o.tipoUnidadId}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  sinPrecio
                    ? 'cursor-not-allowed border-stone-200 bg-stone-50 opacity-70'
                    : 'cursor-pointer border-stone-200 hover:border-lago-400 has-[:checked]:border-lago-600 has-[:checked]:bg-lago-50'
                }`}
              >
                <input
                  type="radio"
                  name="tipo_unidad_id"
                  value={o.tipoUnidadId}
                  defaultChecked={o.tipoUnidadId === primeraCotizable}
                  // Sin tarifa no se puede cotizar: se bloquea acá en lugar de
                  // dejar elegir y fallar recién al confirmar.
                  disabled={sinPrecio}
                  required
                  className="size-4 accent-lago-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-stone-800">{o.nombre}</span>
                  <span className="mt-0.5 block text-sm text-stone-500">
                    hasta {o.capacidadMax} · {o.disponibles}{' '}
                    {o.disponibles === 1 ? 'libre' : 'libres'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {sinPrecio ? (
                    <span className="text-sm font-medium text-lenga-700">Sin tarifa cargada</span>
                  ) : (
                    <>
                      <span className="tabular font-semibold text-stone-900">
                        USD {o.total.toLocaleString('es-AR')}
                      </span>
                      <span className="block text-xs text-stone-500">total de referencia</span>
                    </>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      </Tarjeta>

      <Tarjeta titulo="3 · ¿A nombre de quién?">
        <div className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
          <Campo etiqueta="Apellido" requerido>
            <input name="apellido" required defaultValue={v.apellido ?? ''} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Nombre">
            <input name="nombre" defaultValue={v.nombre ?? ''} className={CAMPO} />
          </Campo>
          <Campo etiqueta="Email" ayuda="Si ya se alojó antes, se reutiliza su ficha.">
            <input
              name="email"
              type="email"
              defaultValue={v.email ?? ''}
              className={CAMPO}
            />
          </Campo>
          <Campo etiqueta="Documento">
            <input name="doc_numero" defaultValue={v.doc_numero ?? ''} className={CAMPO} />
          </Campo>

          <Campo etiqueta="Canal" ayuda="Define si se cotiza con tarifa de mostrador o neta.">
            <select name="canal" defaultValue={v.canal ?? 'directo'} className={CAMPO}>
              <option value="directo">Directo / Mostrador (rack)</option>
              <option value="web">Web (rack)</option>
              <option value="booking">Booking (neto)</option>
              <option value="expedia">Expedia (neto)</option>
            </select>
          </Campo>

          {/* Si la reserva entra por convenio, la agencia es la que factura: de
              ella salen la tarifa neta y la letra del comprobante (ADR 0012). */}
          <Campo
            etiqueta="Agencia / empresa"
            ayuda="Con convenio siempre se aplica tarifa neta, sea cual sea el canal."
          >
            <select name="agencia_id" defaultValue={v.agencia_id ?? ''} className={CAMPO}>
              <option value="">Sin convenio (huésped directo)</option>
              {agencias.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                  {a.descuento_pct > 0 ? ` · ${a.descuento_pct}% dto.` : ''}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </Tarjeta>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}

      <PieDeFormulario>
        <button
          type="submit"
          disabled={pendiente || cotizables.length === 0}
          className={botonClases('primario', 'w-full disabled:cursor-not-allowed sm:w-auto')}
        >
          {pendiente ? 'Confirmando…' : 'Confirmar reserva'}
        </button>
        <Link href="/panel/reservas" className={botonClases('secundario', 'w-full sm:w-auto')}>
          Cancelar
        </Link>
      </PieDeFormulario>
    </form>
  )
}
