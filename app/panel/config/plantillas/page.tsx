import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { EVENTOS_EMAIL, PLANTILLAS, renderizar } from '@/lib/domain/plantillas'
import { obtenerProveedorEmail } from '@/lib/email'
import { enviarPlantillaPrueba } from '../plantillas-actions'
import { CAMPO, Campo, Encabezado, Mensaje, Pagina, Tarjeta } from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

/** Datos de muestra para previsualizar cada plantilla. */
const MUESTRA = {
  nombre: 'Ana',
  codigo: 'BP-DEMO',
  check_in: '10/09/2026',
  check_out: '13/09/2026',
  hora_check_in: '15:00',
  hora_check_out: '10:00',
  total: '642,51',
  enlace: 'https://blancapatagonia.com/ejemplo',
  dias_restantes: '2 días',
  nivel: 'Oro',
  puntos: 2100,
}

const MENSAJES_ERROR: Record<string, string> = {
  plantilla: 'Esa plantilla no existe.',
}

export default async function PlantillasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; detalle?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const proveedorEmail = obtenerProveedorEmail()

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

      {sp.error && (
        <Mensaje tono="error">{sp.detalle ?? MENSAJES_ERROR[sp.error] ?? 'No se pudo enviar.'}</Mensaje>
      )}
      {sp.ok === 'envio' && <Mensaje tono="ok">{sp.detalle ?? 'Correo procesado.'}</Mensaje>}

      <Tarjeta>
        <div className="flex flex-col gap-3 p-5">
          {EVENTOS_EMAIL.map((evento) => {
            const plantilla = PLANTILLAS[evento]
            const vista = renderizar(evento, MUESTRA)
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
                  <p className="mt-3 text-xs text-stone-600">
                    Variables: {plantilla.variables.join(', ')}
                  </p>
                </div>

                {/* Vista de cómo llega en un cliente que sí muestra HTML.
                    `sandbox` sin `allow-scripts`: el HTML es propio (deriva
                    del texto de arriba, `textoAHtml`), pero un iframe aislado
                    no cuesta nada y evita que un estilo de la plantilla se
                    filtre al resto del panel. */}
                <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-white">
                  <p className="border-b border-stone-200 bg-stone-50 px-4 py-1.5 text-xs tracking-wide text-stone-600 uppercase">
                    Vista HTML
                  </p>
                  <iframe
                    title={`Vista HTML de «${plantilla.nombre}»`}
                    srcDoc={vista.cuerpoHtml}
                    sandbox=""
                    className="h-48 w-full"
                  />
                </div>

                {puedeEditar && (
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
                )}
              </div>
            )
          })}
        </div>
      </Tarjeta>
    </Pagina>
  )
}
