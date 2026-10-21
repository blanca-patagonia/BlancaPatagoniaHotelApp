import { requerirAcceso } from '@/lib/auth/session'
import { esDireccion } from '@/lib/domain/permisos'
import { ETIQUETAS_CANAL } from '@/lib/domain/bandeja'
import { duracionLegible, PERIODOS_INFORME, resumirInforme } from '@/lib/domain/bandeja-informes'
import { filasDeInforme, nombresDelEquipo } from '@/lib/bandeja/consultas'
import { Chip, Encabezado, Kpi, Mensaje, Pagina, Tabla, TD, TH, FILA } from '../../_components/ui'
import { IconoCanal } from '../icono-canal'
import { SubNavBandeja } from '../subnav'

/**
 * Informes de la bandeja (Chatwoot: Reports → Overview).
 *
 * Cuatro números que dicen si se está atendiendo bien: cuántas conversaciones,
 * cuántas esperan, cuánto se tarda en contestar y cuánto en resolver. Con
 * MEDIANA y no promedio (ver `lib/domain/bandeja-informes.ts`): dice lo que le
 * pasa a un huésped típico, no lo que arrastra una consulta de la noche.
 */
export default async function InformesPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const sesion = await requerirAcceso('bandeja')
  const sp = await searchParams
  const pedido = Number(sp.dias)
  const dias = (PERIODOS_INFORME as readonly number[]).includes(pedido) ? pedido : 30
  const ahora = new Date()

  const [lectura, nombres] = await Promise.all([filasDeInforme(dias, ahora), nombresDelEquipo()])
  const r = resumirInforme(lectura.datos)

  return (
    <Pagina>
      <Encabezado titulo="Informes de la bandeja" descripcion={`Conversaciones iniciadas en los últimos ${dias} días.`} icono="reportes" />
      <SubNavBandeja direccion={esDireccion(sesion.rol)} />

      <div className="mb-5 flex flex-wrap gap-1.5" aria-label="Período">
        {PERIODOS_INFORME.map((p) => (
          <Chip key={p} href={`/panel/bandeja/informes?dias=${p}`} activo={dias === p}>
            {p} días
          </Chip>
        ))}
      </div>

      {lectura.fallo && <Mensaje tono="error">No se pudieron leer las conversaciones. Los números de abajo no son confiables: recargá la página.</Mensaje>}
      {lectura.truncado && <Mensaje tono="error">Hay más conversaciones de las que se pueden contar acá: los números son parciales.</Mensaje>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Conversaciones" valor={String(r.total)} detalle={`${r.resueltas} resueltas · ${r.abiertas} abiertas`} icono="chat" />
        <Kpi titulo="Esperando respuesta" valor={String(r.sinResponder)} detalle="Todavía sin respuesta de una persona" icono="alerta" tono={r.sinResponder > 0 ? 'calafate' : 'lago'} />
        <Kpi titulo="Primera respuesta" valor={duracionLegible(r.medianaPrimeraRespuesta)} detalle={r.porcentajeRespondidas === null ? 'Sin datos' : `${r.porcentajeRespondidas}% se respondió · mediana`} icono="sobre" />
        <Kpi titulo="Tiempo de resolución" valor={duracionLegible(r.medianaResolucion)} detalle="Hasta que se resuelve · mediana" icono="ok" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="font-display mb-2 text-lg font-semibold text-stone-900">Por canal</h2>
          {r.porCanal.length === 0 ? (
            <p className="text-sm text-stone-500">Sin conversaciones en el período.</p>
          ) : (
            <Tabla resumen="Conversaciones y tiempo de primera respuesta por canal">
              <thead>
                <tr>
                  <th className={TH}>Canal</th>
                  <th className={TH}>Conversaciones</th>
                  <th className={TH}>Primera respuesta</th>
                </tr>
              </thead>
              <tbody>
                {r.porCanal.map((c) => (
                  <tr key={c.canal} className={FILA}>
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        <IconoCanal canal={c.canal} tam={24} />
                        {ETIQUETAS_CANAL[c.canal]}
                      </span>
                    </td>
                    <td className={`${TD} tabular`}>{c.total}</td>
                    <td className={`${TD} tabular`}>{duracionLegible(c.medianaPrimeraRespuesta)}</td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </div>

        <div>
          <h2 className="font-display mb-2 text-lg font-semibold text-stone-900">Por persona</h2>
          {r.porAgente.length === 0 ? (
            <p className="text-sm text-stone-500">Sin conversaciones en el período.</p>
          ) : (
            <Tabla resumen="Conversaciones asignadas y resueltas por persona">
              <thead>
                <tr>
                  <th className={TH}>Atiende</th>
                  <th className={TH}>Asignadas</th>
                  <th className={TH}>Resueltas</th>
                </tr>
              </thead>
              <tbody>
                {r.porAgente.map((a) => (
                  <tr key={a.agenteId ?? 'sin'} className={FILA}>
                    <td className={TD}>{a.agenteId ? (nombres.get(a.agenteId) ?? 'Persona dada de baja') : 'Sin asignar'}</td>
                    <td className={`${TD} tabular`}>{a.total}</td>
                    <td className={`${TD} tabular`}>{a.resueltas}</td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-stone-500">
        La respuesta automática (el saludo y el aviso de fuera de horario) no cuenta como respuesta: sólo cuenta lo que escribe una persona.
      </p>
    </Pagina>
  )
}
