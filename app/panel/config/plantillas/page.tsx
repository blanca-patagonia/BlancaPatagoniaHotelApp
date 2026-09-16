import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { EVENTOS_EMAIL, PLANTILLAS, MUESTRA_PLANTILLAS, renderizar } from '@/lib/domain/plantillas'
import { obtenerProveedorEmail } from '@/lib/email'
import { enviarPlantillaPrueba } from '../plantillas-actions'
import { PlantillaEditable } from '../plantilla-editable'
import { CAMPO, Campo, Encabezado, Mensaje, Pagina, Tarjeta } from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

interface OverridePlantilla {
  asunto: string | null
  cuerpo: string | null
}

const MENSAJES_ERROR: Record<string, string> = {
  plantilla: 'Esa plantilla no existe.',
  plantilla_restaurar: 'No se pudo restaurar el texto original. Probá de nuevo.',
}

export default async function PlantillasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; detalle?: string; evento?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const proveedorEmail = obtenerProveedorEmail()

  const supabase = await crearClienteServidor()
  const { data: overridesData, error: eOverrides } = await supabase
    .from('plantillas_email')
    .select('evento, asunto, cuerpo')
  if (eOverrides) registrarFalla(eOverrides, 'config:plantillas')
  const overrides = new Map<string, OverridePlantilla>(
    (overridesData ?? []).map((o) => [o.evento as string, o as OverridePlantilla]),
  )

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Plantillas de correo"
        descripcion={
          proveedorEmail.esReal()
            ? 'Comunicaciones automáticas al huésped.'
            : 'Comunicaciones al huésped · proveedor simulado: los correos NO se envían.'
        }
        icono="config"
      />

      {/*
        El resultado de "Enviar prueba" se muestra ABAJO, junto a la plantilla
        que corresponde (`sp.evento`) — no acá. Esta página tiene ~25
        plantillas: un aviso genérico arriba de todo queda invisible para
        quien clickeó "Enviar prueba" de una que está más abajo, sin scroll
        automático que lo traiga de vuelta al principio. Es exactamente el
        bug que se reportó como «el botón no responde nada»: sí respondía,
        pero fuera de la vista de quien lo apretó.
      */}
      {sp.error && sp.error !== 'envio' && (
        <Mensaje tono="error">{sp.detalle ?? MENSAJES_ERROR[sp.error] ?? 'No se pudo enviar.'}</Mensaje>
      )}
      {eOverrides && (
        <Mensaje tono="error">
          No se pudo leer qué plantillas están editadas — puede mostrarse el texto original de
          alguna que en realidad tiene un cambio guardado.
        </Mensaje>
      )}

      <Tarjeta>
        <div className="flex flex-col gap-3 p-5">
          {EVENTOS_EMAIL.map((evento) => {
            const plantilla = PLANTILLAS[evento]
            const override = overrides.get(evento)
            const vista = renderizar(evento, MUESTRA_PLANTILLAS, override)
            return (
              <div
                key={evento}
                className="rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3"
              >
                <h3 className="text-sm font-medium text-stone-800">
                  {plantilla.nombre}
                  <span className="ml-2 text-xs font-normal text-stone-500">
                    {plantilla.disparador}
                  </span>
                </h3>

                <div className="mt-3 rounded-lg border border-stone-200 bg-white p-4">
                  <p className="text-xs tracking-wide text-stone-600 uppercase">Asunto</p>
                  <p className="text-sm font-medium text-stone-800">{vista.asunto}</p>
                  <p className="mt-3 text-xs tracking-wide text-stone-600 uppercase">Cuerpo (texto plano)</p>
                  <p className="mt-1 text-sm whitespace-pre-line text-stone-700">{vista.cuerpo}</p>
                  <p className="mt-3 text-xs tracking-wide text-stone-600 uppercase">
                    Vista HTML{' '}
                    <span className="font-normal normal-case text-stone-400">
                      — el marco tiene alto fijo, desplazate adentro para ver el resto
                    </span>
                  </p>
                  {/*
                    `sandbox` sin valor es la caja más chica que existe: ni scripts, ni
                    formularios, ni same-origin. Es una vista previa, no contenido de
                    confianza — el texto de origen viene de {{nombre}} y compañía, y
                    aunque `textoAHtml` ya escapa antes de formatear, esta es la segunda
                    barrera si algún día una plantilla nueva no pasa por ese camino.

                    El iframe SÍ scrollea solo cuando el contenido no entra —
                    no hace falta `overflow` a mano—, pero la barra nativa (sobre
                    todo en macOS) es invisible hasta que se la toca: sin aviso,
                    un cuerpo largo se ve cortado y nada indica que sigue. Por eso
                    el texto de arriba lo dice explícito, en vez de confiar en que
                    se note.
                  */}
                  <iframe
                    title={`Vista HTML — ${plantilla.nombre}`}
                    srcDoc={vista.cuerpoHtml}
                    sandbox=""
                    className="mt-1 h-72 w-full rounded-lg border border-stone-200"
                  />
                  <p className="mt-3 text-xs text-stone-600">
                    Variables: {plantilla.variables.join(', ')}
                  </p>
                </div>

                {puedeEditar && (
                  <>
                    <form
                      action={enviarPlantillaPrueba}
                      className="mt-4 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="evento" value={evento} />
                      <div className="min-w-0 flex-1 sm:max-w-xs">
                        <Campo
                          etiqueta="Mandarme una prueba"
                          ayuda="Si lo dejás vacío, va a tu propio email."
                        >
                          <input name="para" type="email" className={CAMPO} />
                        </Campo>
                      </div>
                      <BotonEnvio variante="secundario" cargando="Enviando…">
                        Enviar prueba
                      </BotonEnvio>
                    </form>
                    {sp.evento === evento && sp.ok === 'envio' && (
                      <div className="mt-2">
                        <Mensaje tono="ok">{sp.detalle ?? 'Correo procesado.'}</Mensaje>
                      </div>
                    )}
                    {sp.evento === evento && sp.error === 'envio' && (
                      <div className="mt-2">
                        <Mensaje tono="error">{sp.detalle ?? 'No se pudo enviar.'}</Mensaje>
                      </div>
                    )}
                  </>
                )}

                <PlantillaEditable
                  evento={evento}
                  asuntoFuente={override?.asunto ?? plantilla.asunto}
                  cuerpoFuente={override?.cuerpo ?? plantilla.cuerpo}
                  editada={Boolean(override)}
                  puedeEditar={puedeEditar}
                />
              </div>
            )
          })}
        </div>
      </Tarjeta>
    </Pagina>
  )
}
