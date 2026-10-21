import Link from 'next/link'
import { requerirRol } from '@/lib/auth/session'
import {
  ETIQUETAS_ESTADO_INTEGRACION,
  ETIQUETAS_GRUPO,
  INTEGRACIONES,
  ORDEN_GRUPOS,
  diagnosticar,
  urlWebhook,
  type EstadoIntegracion,
} from '@/lib/domain/integraciones'
import { tieneSonda } from '@/lib/integraciones/sondas'
import { Encabezado, Etiqueta, Pagina, botonClases, type Tono } from '../../_components/ui'
import { BotonConectarTelegram, BotonProbar } from './boton-probar'

/**
 * Integraciones y claves (ADR 0043).
 *
 * Una ficha por servicio externo: para qué sirve, qué variables lleva (cargada
 * o no, NUNCA su valor), dónde se consigue cada una, la URL del webhook para
 * pegar del lado del proveedor y un botón para probar que la clave anda.
 *
 * Las claves NO se cargan desde acá, a propósito: van en las variables de
 * entorno (`.env.local` en desarrollo, el panel de Vercel en producción). Una
 * clave guardada en la base la puede leer cualquiera que tenga un volcado; una
 * variable de entorno, sólo quien administra el servidor.
 */

const TONO: Record<EstadoIntegracion, Tono> = {
  lista: 'exito',
  incompleta: 'peligro',
  apagada: 'alerta',
  sin_configurar: 'neutro',
}

export default async function IntegracionesPage() {
  await requerirRol('admin', 'gerencia')
  const env = process.env
  const sitio = env.NEXT_PUBLIC_SITE_URL
  const diagnosticos = new Map(INTEGRACIONES.map((i) => [i.id, diagnosticar(i, env)]))
  const listas = [...diagnosticos.values()].filter((d) => d.estado === 'lista').length

  return (
    <Pagina>
      <Encabezado
        titulo="Integraciones y claves"
        descripcion={`${listas} de ${INTEGRACIONES.length} servicios configurados. Las claves se cargan en las variables de entorno; acá se ve cuáles faltan y se prueba cada una.`}
        icono="config"
        acciones={
          <Link href="/panel/config" className={botonClases('secundario')}>
            Volver a configuración
          </Link>
        }
      />

      <div className="mb-6 rounded-2xl border border-lago-200 bg-lago-50 px-4 py-3 text-sm text-lago-900">
        <p className="font-medium">Cómo se carga una clave</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>
            En la computadora de desarrollo: en el archivo <code>.env.local</code> (la plantilla con todas las variables
            sale de <code>npm run integraciones -- --plantilla</code>), y reiniciar con <code>npm run dev</code>.
          </li>
          <li>En producción: Vercel → el proyecto → Settings → Environment Variables, y volver a desplegar.</li>
          <li>
            Volver acá y tocar «Probar la conexión». Desde la terminal: <code>npm run integraciones</code>.
          </li>
        </ol>
      </div>

      {ORDEN_GRUPOS.map((grupo) => {
        const delGrupo = INTEGRACIONES.filter((i) => i.grupo === grupo)
        if (delGrupo.length === 0) return null
        return (
          <section key={grupo} className="mb-8">
            <h2 className="font-display mb-3 text-lg font-semibold text-stone-900">{ETIQUETAS_GRUPO[grupo]}</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {delGrupo.map((i) => {
                const d = diagnosticos.get(i.id)!
                return (
                  <article key={i.id} id={i.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                    <header className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-stone-900">{i.nombre}</h3>
                        <p className="text-sm text-stone-600">{i.paraQue}</p>
                      </div>
                      <Etiqueta tono={TONO[d.estado]}>{ETIQUETAS_ESTADO_INTEGRACION[d.estado]}</Etiqueta>
                    </header>

                    {d.indicacion && <p className="text-sm font-medium text-red-800">{d.indicacion}</p>}
                    {d.estado === 'sin_configurar' && <p className="text-sm text-stone-600">Si falta: {i.siFalta}</p>}
                    {i.limitacion && (
                      <p className="rounded-lg bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200">⚠️ {i.limitacion}</p>
                    )}

                    {(i.interruptor || i.variables.length > 0) && (
                      <ul className="space-y-1.5 text-sm">
                        {i.interruptor && (
                          <li className="flex flex-wrap items-baseline gap-x-2">
                            <span aria-hidden="true">{env[i.interruptor.variable]?.trim() ? '●' : '○'}</span>
                            <code className="text-xs">{i.interruptor.variable}</code>
                            <span className="text-xs text-stone-500">
                              {i.interruptor.lista ? `tiene que incluir «${i.interruptor.valor}»` : `= ${i.interruptor.valor}`}
                            </span>
                          </li>
                        )}
                        {i.variables.map((v) => {
                          const cargada = Boolean(env[v.nombre]?.trim())
                          return (
                            <li key={v.nombre} className="flex flex-wrap items-baseline gap-x-2">
                              <span className={cargada ? 'text-emerald-700' : v.obligatoria ? 'text-red-700' : 'text-stone-400'}>
                                {cargada ? '✓' : '✗'}
                                <span className="sr-only">{cargada ? ' cargada' : ' falta'}</span>
                              </span>
                              <code className="text-xs break-all">{v.nombre}</code>
                              {!v.obligatoria && <span className="text-xs text-stone-500">(opcional)</span>}
                              <span className="w-full pl-5 text-xs text-stone-600">
                                {v.ayuda}
                                {v.ejemplo && (
                                  <>
                                    {' '}
                                    Ej.: <code className="break-all">{v.ejemplo}</code>
                                  </>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    {i.webhook && (
                      <div className="text-sm">
                        <p className="text-xs font-medium text-stone-600">URL del webhook (se pega del lado del proveedor)</p>
                        <code className="block rounded-lg bg-stone-100 px-2 py-1 text-xs break-all select-all">{urlWebhook(sitio, i.webhook.ruta)}</code>
                        <p className="mt-0.5 text-xs text-stone-500">{i.webhook.nota}</p>
                      </div>
                    )}

                    <div className="text-sm">
                      <p className="text-xs font-medium text-stone-600">Dónde se consigue</p>
                      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-stone-700">
                        {i.pasos.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ol>
                    </div>

                    <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {i.probable && tieneSonda(i.id) && d.estado !== 'sin_configurar' && <BotonProbar id={i.id} />}
                      {i.id === 'telegram' && d.estado === 'lista' && <BotonConectarTelegram />}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}
    </Pagina>
  )
}
