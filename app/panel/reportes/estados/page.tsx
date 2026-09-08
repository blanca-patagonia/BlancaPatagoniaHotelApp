import { requerirAcceso } from '@/lib/auth/session'
import { ESTADOS_RESERVA, ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { traerReservas } from '../datos'
import { AvisoIncompleto } from '../_componentes'
import { TONO_ESTADO } from '../../_components/estilos'
import { Encabezado, Etiqueta, Pagina, Tarjeta } from '../../_components/ui'

/**
 * Reservas por estado.
 *
 * Histórico: no lleva selector de mes. La pregunta que contesta es cuántas
 * reservas se caen —canceladas y no-show contra las que llegaron a checkout—.
 */
export default async function InformeEstadosPage() {
  await requerirAcceso('reportes')

  const reservas = await traerReservas()

  const porEstado = new Map<EstadoReserva, number>()
  for (const r of reservas.filas) {
    porEstado.set(r.estado, (porEstado.get(r.estado) ?? 0) + 1)
  }
  const maxEstado = Math.max(1, ...porEstado.values())
  const total = reservas.filas.length

  return (
    <Pagina>
      <Encabezado
        titulo="Reservas por estado"
        descripcion={`Distribución histórica de las ${total.toLocaleString('es-AR')} reservas cargadas.`}
        icono="reservas"
      />

      <AvisoIncompleto incompleto={reservas.truncado} />

      <Tarjeta titulo="Distribución" descripcion="Histórico completo, no del mes">
        <div className="flex flex-col gap-2 p-5">
          {ESTADOS_RESERVA.map((e) => {
            const n = porEstado.get(e) ?? 0
            return (
              <div key={e} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0">
                  <Etiqueta tono={TONO_ESTADO[e]}>{ETIQUETAS_ESTADO_RESERVA[e]}</Etiqueta>
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-lago-500"
                    style={{ width: `${(n / maxEstado) * 100}%` }}
                  />
                </div>
                {/* El porcentaje además del número: «40» no dice nada sin saber
                    sobre cuántas, y es la lectura que importa acá. */}
                <span className="tabular w-20 text-right font-medium text-stone-700">
                  {n}
                  {total > 0 && (
                    <span className="ml-1 font-normal text-stone-500">
                      {Math.round((n / total) * 100)}%
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </Tarjeta>
    </Pagina>
  )
}
