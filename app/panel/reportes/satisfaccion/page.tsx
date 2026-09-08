import { requerirAcceso } from '@/lib/auth/session'
import {
  resumenNps,
  interpretarNps,
  tasaRespuesta,
  ETIQUETAS_NPS,
  CATEGORIAS_NPS,
} from '@/lib/domain/encuestas'
import { traerEncuestas } from '../datos'
import { AvisoIncompleto } from '../_componentes'
import { Encabezado, Pagina, Tarjeta } from '../../_components/ui'

/**
 * Satisfacción del huésped (NPS).
 *
 * Histórico: no lleva selector de mes. Ponerle uno que no cambia nada haría
 * creer que el índice mostrado es el de ese mes.
 */
export default async function InformeSatisfaccionPage() {
  await requerirAcceso('reportes')

  const encuestas = await traerEncuestas()

  // Las encuestas sin responder no se cuentan como cero: eso hundiría el índice
  // (ver `lib/domain/encuestas.ts`).
  const nps = resumenNps(encuestas.filas.map((e) => e.puntaje))
  const respuesta = tasaRespuesta(
    encuestas.filas.length,
    encuestas.filas.filter((e) => e.respondida_en).length,
  )
  const maxNps = Math.max(1, nps.promotores, nps.pasivos, nps.detractores)

  return (
    <Pagina>
      <Encabezado
        titulo="Satisfacción del huésped"
        descripcion="Net Promoter Score de las encuestas posteriores al check-out."
        icono="reportes"
      />

      <AvisoIncompleto incompleto={encuestas.truncado} />

      <Tarjeta titulo="NPS" descripcion="Histórico completo, no del mes">
        <div className="grid gap-6 p-5 sm:grid-cols-[10rem_1fr]">
          <div className="text-center sm:text-left">
            <p className="tabular font-display text-4xl leading-none font-semibold text-stone-900">
              {nps.nps ?? '—'}
            </p>
            <p className="mt-1 text-sm font-medium text-lago-700">{interpretarNps(nps.nps)}</p>
            <p className="mt-1 text-xs text-stone-600">
              {nps.respuestas} respuesta(s)
              {respuesta !== null && ` · ${respuesta}% de respuesta`}
            </p>
            {nps.promedio !== null && (
              <p className="tabular text-xs text-stone-600">Promedio {nps.promedio} / 10</p>
            )}
          </div>

          <div className="flex flex-col justify-center gap-2">
            {CATEGORIAS_NPS.map((c) => {
              const n =
                c === 'promotor' ? nps.promotores : c === 'pasivo' ? nps.pasivos : nps.detractores
              const color =
                c === 'promotor' ? 'bg-emerald-500' : c === 'pasivo' ? 'bg-stone-300' : 'bg-red-500'
              return (
                <div key={c} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-stone-500">{ETIQUETAS_NPS[c]}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width: `${(n / maxNps) * 100}%` }}
                    />
                  </div>
                  <span className="tabular w-6 text-right font-medium text-stone-700">{n}</span>
                </div>
              )
            })}
            {nps.respuestas === 0 && (
              <p className="mt-1 text-xs text-stone-600">
                Las encuestas se generan solas al hacer el check-out de una reserva.
              </p>
            )}
          </div>
        </div>
      </Tarjeta>
    </Pagina>
  )
}
