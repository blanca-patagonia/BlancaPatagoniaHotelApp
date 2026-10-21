import { type EstadoReserva } from '@/lib/domain/reservas'
import { type CargoDeCancelacion } from '@/lib/reservas/cancelacion'
import { formatearUSD } from '@/lib/domain/moneda'
import { cambiarEstadoReserva } from '../actions'
import { BotonEnvio } from '../../_components/boton-envio'

const ACCION_ESTADO: Record<EstadoReserva, { verbo: string; color: string }> = {
  pendiente: { verbo: 'Marcar pendiente', color: 'bg-stone-600 hover:bg-stone-700' },
  confirmada: { verbo: 'Confirmar', color: 'bg-lago-700 hover:bg-lago-800' },
  pagada: { verbo: 'Marcar pagada', color: 'bg-emerald-600 hover:bg-emerald-700' },
  in_house: { verbo: 'Check-in', color: 'bg-lenga-600 hover:bg-lenga-700' },
  checkout: { verbo: 'Check-out', color: 'bg-stone-700 hover:bg-stone-800' },
  cancelada: { verbo: 'Cancelar', color: 'bg-red-600 hover:bg-red-700' },
  no_show: { verbo: 'No-show', color: 'bg-red-600 hover:bg-red-700' },
}

/** Los botones de cambio de estado y el cargo estimado por cancelar hoy. */
export function SeccionAcciones({
  reserva,
  transiciones,
  cargo,
}: {
  reserva: { id: string; codigo: string }
  transiciones: readonly EstadoReserva[]
  cargo: CargoDeCancelacion | null
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-stone-700">Acciones</h2>
      {transiciones.length === 0 ? (
        <p className="text-sm text-stone-600">La reserva está en un estado final.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {transiciones.map((t) => (
            <form key={t} action={cambiarEstadoReserva}>
              <input type="hidden" name="reserva_id" value={reserva.id} />
              <input type="hidden" name="nuevo_estado" value={t} />
              {/* `BotonEnvio` bloquea el botón mientras la acción viaja al
                  servidor: sin eso, un segundo clic impaciente repetía la
                  operación. Cancelar y no-show piden confirmación porque no
                  tienen vuelta atrás: son estados terminales. */}
              <BotonEnvio
                variante="primario"
                extra={`text-white ${ACCION_ESTADO[t].color}`}
                cargando="Aplicando…"
                confirmar={
                  t === 'cancelada'
                    ? `¿Cancelar la reserva ${reserva.codigo}?${cargo && cargo.monto > 0 ? ` Corresponde un cargo de ${formatearUSD(cargo.monto)}.` : ''} No se puede deshacer.`
                    : t === 'no_show'
                      ? `¿Marcar ${reserva.codigo} como no-show? Se cobra la estadía completa y no se puede deshacer.`
                      : undefined
                }
              >
                {ACCION_ESTADO[t].verbo}
              </BotonEnvio>
            </form>
          ))}
        </div>
      )}
      {cargo && (
        <p className="mt-3 text-xs text-stone-500">
          Cancelación hoy (
          {cargo.dias >= 0
            ? `${cargo.dias} días antes del check-in`
            : 'check-in ya transcurrido'}
          ): cargo estimado{' '}
          <span className="font-medium text-stone-700">
            {formatearUSD(cargo.monto)}
          </span>{' '}
          según la política estándar.
        </p>
      )}
    </div>
  )
}
