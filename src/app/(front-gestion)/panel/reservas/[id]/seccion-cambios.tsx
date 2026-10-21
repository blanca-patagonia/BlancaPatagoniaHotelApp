import {
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  PLANES,
  SEGMENTOS,
} from '@/lib/domain/reservas'
import { type Ocupantes } from '@/lib/domain/ocupantes'
import { type cotizarEstadia } from '@/lib/pricing/cotizar'
import { type unidadesDisponibles } from '@/lib/availability/disponibilidad'
import { formatoFechaCorta, type Periodo } from '@/lib/fechas'
import { formatearUSD } from '@/lib/domain/moneda'
import { reprogramarReserva, cambiarUnidadReserva, editarFichaReserva } from '../cambios.actions'
import { BotonEnvio } from '../../_components/boton-envio'
import { Icono } from '../../_components/iconos'
import { type EstadiaReserva, type Reserva } from './seccion-datos'

/**
 * Los tres cambios que se le pueden hacer a una reserva viva sin tocar su
 * estado: reprogramar (fechas, recotiza), mudar de unidad y editar la ficha
 * (nunca recotiza). Son sólo presentación: las condiciones para mostrar cada
 * uno las decide `page.tsx`.
 */

type Cotizacion = Awaited<ReturnType<typeof cotizarEstadia>>
type UnidadLibre = Awaited<ReturnType<typeof unidadesDisponibles>>[number]

export function SeccionReprogramar({
  reserva,
  periodo,
  nuevoCheckIn,
  nuevoCheckOut,
  previewValido,
  previewCotizacion,
}: {
  reserva: { id: string; total: number | string }
  periodo: Periodo
  nuevoCheckIn: string | undefined
  nuevoCheckOut: string | undefined
  previewValido: boolean
  previewCotizacion: Cotizacion | null
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-stone-700">Reprogramar</h2>

      {/*
        Paso de consulta, no de acción: por eso es GET y las fechas viajan
        en la URL, mismo criterio que «Buscar disponibilidad» en el alta
        de reservas. Antes había que reprogramar a ciegas para enterarse
        del total nuevo — el aviso de abajo ya decía «recotiza el total»,
        pero recién después de confirmar (patrón de referencia: Hotel
        PMS, re-precio inline en la ficha de reserva).
      */}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
          <span className="text-stone-500">Nuevo check-in</span>
          <input
            type="date"
            name="nuevo_check_in"
            defaultValue={nuevoCheckIn || periodo.desde}
            className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
          <span className="text-stone-500">Nuevo check-out</span>
          <input
            type="date"
            name="nuevo_check_out"
            defaultValue={nuevoCheckOut || periodo.hasta}
            className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 sm:w-auto"
        >
          Ver nuevo precio
        </button>
      </form>

      {previewValido && (
        <div className="mt-3 rounded-lg bg-lago-50 p-3 text-sm ring-1 ring-lago-200">
          {!previewCotizacion || previewCotizacion.faltanTarifas ? (
            <p className="text-lago-900">
              No hay tarifa cargada para esas fechas: no se puede calcular el nuevo total.
            </p>
          ) : (
            <p className="text-lago-900">
              Nuevo total: <span className="font-semibold">{formatearUSD(previewCotizacion.resumen.total)}</span>{' '}
              <span className="text-lago-700">(antes {formatearUSD(Number(reserva.total))})</span>
            </p>
          )}
        </div>
      )}

      {previewValido && previewCotizacion && !previewCotizacion.faltanTarifas && (
        <form action={reprogramarReserva} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="reserva_id" value={reserva.id} />
          <input type="hidden" name="check_in" value={nuevoCheckIn!} />
          <input type="hidden" name="check_out" value={nuevoCheckOut!} />
          <BotonEnvio extra="w-full sm:w-auto" cargando="Reprogramando…">
            Confirmar reprogramación
          </BotonEnvio>
        </form>
      )}
      <p className="mt-2 text-xs text-stone-600">
        {previewValido
          ? 'Se rechaza si la unidad ya está ocupada en esas fechas.'
          : 'Elegí las fechas nuevas y mirá el precio antes de confirmar.'}
      </p>
    </div>
  )
}

export function SeccionMudanza({
  reserva,
  periodo,
  noMover,
  libres,
  nombreTipo,
}: {
  reserva: { id: string }
  periodo: Periodo
  noMover: boolean | undefined
  libres: readonly UnidadLibre[]
  nombreTipo: Map<string, string>
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-medium text-stone-700">Cambiar de unidad</h2>
      <p className="mb-3 text-xs text-stone-600">
        Para averías, pedidos del huésped o para liberar la habitación. Solo se listan las
        unidades libres en {formatoFechaCorta(periodo.desde)} – {formatoFechaCorta(periodo.hasta)}.
      </p>

      {/* Acá es donde «no mover» sirve. Sin este aviso, el motivo por el que
          se le asignó esa habitación —vista al lago, planta baja, la de
          siempre— se pierde en el momento exacto en que importa. */}
      {noMover && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-lenga-50 px-3 py-2 text-xs ring-1 ring-lenga-200">
          <span className="shrink-0 text-lenga-700">
            <Icono nombre="alerta" tam={14} />
          </span>
          <span className="text-lenga-900">
            <strong className="font-semibold">Marcada «no mover»:</strong> el huésped pidió esta
            unidad en particular. Confirmá con él antes de cambiarla.
          </span>
        </div>
      )}

      {libres.length === 0 ? (
        <p className="text-sm text-stone-600">
          No hay otra unidad libre en esas fechas. Se puede liberar una reprogramando o
          cancelando otra reserva.
        </p>
      ) : (
        <form action={cambiarUnidadReserva} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="reserva_id" value={reserva.id} />
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Nueva unidad</span>
            <select
              name="unidad_destino"
              required
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              <option value="">Elegir…</option>
              {libres.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} · {nombreTipo.get(u.tipo_unidad_id) ?? 'sin tipo'}
                  {u.estado === 'sucia' ? ' (sucia)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Motivo</span>
            <input
              name="motivo"
              placeholder="Calefactor roto"
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Si cambia el tipo</span>
            <select
              name="politica_tarifa"
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              <option value="mantener">Mantener la tarifa pactada</option>
              <option value="recotizar">Recotizar según el nuevo tipo</option>
            </select>
          </label>
          <BotonEnvio extra="w-full sm:w-auto" cargando="Mudando…">
            Mudar
          </BotonEnvio>
        </form>
      )}
      <p className="mt-2 text-xs text-stone-600">
        Dentro del mismo tipo el precio no cambia. La unidad que se libera queda sucia solo si
        el huésped ya había hecho el check-in.
      </p>
    </div>
  )
}

/**
 * Lo que se tecleó la última vez que «Editar ficha» rechazó el envío. Viene
 * de la URL y, si está, gana sobre el valor guardado en la base.
 */
export interface IntentoDeFicha {
  plan?: string
  segmento?: string
  voucher?: string
  notas?: string
  adultos?: string
  menores?: string
  bebes?: string
  cunas?: string
  noMover?: string
}

export function SeccionEditarFicha({
  reserva,
  estadia,
  ocupantes,
  intento,
}: {
  reserva: Pick<Reserva, 'id' | 'plan' | 'segmento' | 'voucher' | 'notas'>
  estadia: EstadiaReserva
  ocupantes: Ocupantes
  /** `null` cuando no hubo un envío rechazado: se muestran los valores guardados. */
  intento: IntentoDeFicha | null
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-medium text-stone-700">Editar ficha</h2>
      <p className="mb-3 text-xs text-stone-600">
        Plan, segmento, voucher, notas y la composición de la habitación. No cambia el precio
        ni el estado de la reserva — eso es «Reprogramar» y los botones de estado, arriba.
      </p>
      <form action={editarFichaReserva} className="flex flex-col gap-3">
        <input type="hidden" name="reserva_id" value={reserva.id} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Plan</span>
            <select
              name="plan"
              defaultValue={intento ? intento.plan : reserva.plan}
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              {PLANES.map((p) => (
                <option key={p} value={p}>
                  {ETIQUETAS_PLAN[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Segmento</span>
            <select
              name="segmento"
              defaultValue={intento ? intento.segmento : reserva.segmento}
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              {SEGMENTOS.map((s) => (
                <option key={s} value={s}>
                  {ETIQUETAS_SEGMENTO[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs sm:col-span-1">
            <span className="text-stone-500">Voucher</span>
            <input
              name="voucher"
              defaultValue={intento ? intento.voucher : reserva.voucher}
              placeholder="Nº del canal o agencia"
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Adultos</span>
            <input
              name="adultos"
              type="number"
              min={1}
              defaultValue={intento ? intento.adultos : ocupantes.adultos}
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Menores</span>
            <input
              name="menores"
              type="number"
              min={0}
              defaultValue={intento ? intento.menores : ocupantes.menores}
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Bebés</span>
            <input
              name="bebes"
              type="number"
              min={0}
              defaultValue={intento ? intento.bebes : ocupantes.bebes}
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Cunas</span>
            <input
              name="cunas"
              type="number"
              min={0}
              defaultValue={intento ? intento.cunas : ocupantes.cunas}
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="col-span-2 flex items-center gap-2 self-end pb-1.5 text-xs sm:col-span-1">
            <input
              type="checkbox"
              name="no_mover"
              value="1"
              defaultChecked={intento ? intento.noMover === '1' : estadia.no_mover}
              className="size-4 rounded border-stone-300"
            />
            <span className="text-stone-700">No mover de habitación</span>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-stone-500">Notas</span>
          <textarea
            name="notas"
            defaultValue={intento ? intento.notas : reserva.notas}
            rows={2}
            className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div>
          <BotonEnvio extra="w-full sm:w-auto" cargando="Guardando…">
            Guardar ficha
          </BotonEnvio>
        </div>
      </form>
      <p className="mt-2 text-xs text-stone-600">
        Entran {estadia.unidad?.tipo?.capacidad_max ?? '—'} persona(s) en esta unidad (los
        bebés en cuna no cuentan).
      </p>
    </div>
  )
}
