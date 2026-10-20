import type { DatosCanales } from '../_datos'
import { describirUltimaLectura } from '@/lib/canales/ical-saliente'
import { EstadoVacio, Etiqueta, Tarjeta } from '../../_components/ui'

/** Vista «calendario» de la pantalla de canales. Los datos los carga `_datos.ts`. */
export function VistaCalendario({ d }: { d: DatosCanales }) {
  const { configIcal, feeds } = d
  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Calendario de ocupación para el canal"
        descripcion="Las direcciones que hay que pegar en el extranet para que cierre fechas solo."
      >
        <div className="space-y-3 text-sm text-stone-700">
          <p>
            Cada dirección de acá abajo es un calendario que Booking, Airbnb o Expedia pueden leer.
            Se pega una vez en el extranet, en la sección de calendarios importados o sincronización
            de calendarios, y a partir de ahí el canal cierra solo las fechas en las que no queda
            lugar.
          </p>
          <p className="rounded-lg bg-lenga-50 px-3 py-2 text-lenga-900 ring-1 ring-lenga-200">
            <strong>Esto angosta la ventana del overbooking, no la cierra.</strong> El canal relee
            el calendario cada varias horas y no promete cada cuánto; entre que se vende la última
            unidad y que se entera, puede vender de nuevo. Y nadie confirma que lo aplicó: lo único
            que se sabe es si pasó a buscarlo.
          </p>
          <p>
            <strong>Son direcciones secretas.</strong> Quien las tenga puede ver qué días está lleno
            el hotel. No traen ningún dato de los huéspedes, pero conviene no publicarlas ni
            mandarlas por fuera del extranet.
          </p>
        </div>
      </Tarjeta>

      {!configIcal ? (
        <EstadoVacio
          titulo="Todavía no hay configuración del canal"
          descripcion="El calendario sale del token que se genera al configurar Booking en Costos y comisión. Sin esa fila no hay ninguna dirección que publicar."
        />
      ) : (
        <>
          <Tarjeta titulo="¿Lo están leyendo?">
            <p className="text-sm text-stone-700">
              {describirUltimaLectura(configIcal.ical_leido_en, new Date())}.{' '}
              {configIcal.ical_leido_en ? (
                <span className="text-stone-500">
                  Es lo más parecido a un acuse de recibo que permite este formato: dice que
                  vinieron a buscar el archivo, no que hayan cerrado las fechas.
                </span>
              ) : (
                <span className="text-stone-500">
                  Si ya se pegó la dirección en el extranet y sigue diciendo esto al día siguiente,
                  lo más probable es que esté copiada de más o de menos.
                </span>
              )}
            </p>
          </Tarjeta>

          {feeds.map((f) => (
            <Tarjeta
              key={f.codigo}
              titulo={f.nombre}
              descripcion={`${f.cuantas} unidad(es) activa(s) · código ${f.codigo}`}
            >
              <div className="space-y-3">
                <div>
                  <Etiqueta>Calendario del tipo</Etiqueta>
                  <p className="mt-1 break-all rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs text-stone-800 ring-1 ring-stone-200">
                    {f.url}
                  </p>
                </div>

                {/*
                      La limitación que hay que decir por tipo, no en general: con más
                      de una unidad el calendario recién cierra cuando se vendieron
                      todas. No es un defecto que se pueda arreglar acá —un calendario
                      dice «ocupado», no «me queda una»— y cerrar antes le costaría
                      ventas reales al hotel.
                    */}
                {f.cuantas > 1 && (
                  <div className="rounded-lg bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200">
                    <p>
                      Este tipo tiene <strong>{f.cuantas} unidades</strong>, así que este calendario
                      marca ocupado <strong>recién cuando se vendieron las {f.cuantas}</strong>.
                      Antes de eso todavía hay lugar y cerrarlo sería perder ventas.
                    </p>
                    <p className="mt-1">
                      Si en el extranet cada unidad figura como una habitación aparte, conviene usar
                      el calendario de cada una:
                    </p>
                    <ul className="mt-2 space-y-2">
                      {f.unidades.map((u) => (
                        <li key={u.nombre}>
                          <span className="font-semibold">{u.nombre}</span>
                          <p className="mt-0.5 break-all rounded bg-white/70 px-2 py-1 font-mono text-xs text-stone-800">
                            {u.url}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Tarjeta>
          ))}

          {feeds.length === 0 && (
            <EstadoVacio
              titulo="No hay tipos de unidad activos"
              descripcion="Sin inventario cargado no hay calendario que publicar."
            />
          )}
        </>
      )}
    </div>
  )
}
