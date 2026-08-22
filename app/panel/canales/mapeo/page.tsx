import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { CAMPOS_BOOKING, CAMPOS_OBLIGATORIOS, ETIQUETAS_CAMPO } from '@/lib/canales/csv'
import { BotonEnvio } from '../../_components/boton-envio'
import {
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Mensaje,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../../_components/ui'
import { borrarMapeo, guardarMapeo } from './actions'

/**
 * Decirle al sistema qué columna del informe es cuál.
 *
 * ── Por qué esta pantalla existe ────────────────────────────────────────────
 *
 * El lector adivina los encabezados con un diccionario de alias, y cuando no acierta
 * la importación moría en un mensaje inútil: «bajá el informe sin modificarlo» no
 * ayuda si el export de esta cuenta simplemente tiene otros nombres de columna.
 *
 * El hotel **no sabe qué formato tiene su export**, así que el diccionario no se pudo
 * calibrar contra un archivo real. Esta pantalla es la salida: una persona mira el
 * archivo, dice qué es cada cosa, y no vuelve a preguntar nunca para ese formato.
 *
 * ── Por qué se muestran valores de ejemplo ──────────────────────────────────
 *
 * Es lo que hace que la pantalla sea usable por alguien que no reconoce los
 * encabezados de su propio export. Puede no saber qué significa «Ref», pero reconoce
 * `1234567890` como un número de reserva y `25/09/2026` como una fecha. Sin los
 * ejemplos, la pantalla le pide adivinar; con ellos, le pide leer.
 *
 * ── Por qué no se guarda el archivo ─────────────────────────────────────────
 *
 * No hay Storage y el archivo tiene apellidos, correos y teléfonos de huéspedes. Lo
 * que se guarda son los encabezados y hasta tres valores de ejemplo por columna. El
 * usuario mapea, vuelve, y sube el archivo otra vez — una sola vez en la vida del
 * formato.
 */

const MENSAJES_ERROR: Record<string, string> = {
  falta_id: 'Faltó indicar cuál era el formato.',
  no_existe: 'Ese formato ya no existe. Volvé a subir el archivo para empezar de nuevo.',
  sin_encabezados:
    'Ese borrador no guardó los encabezados del archivo. Volvé a subir el archivo para empezar de nuevo.',
  invalido: 'No se pudo guardar el mapeo. El detalle está abajo.',
  lectura: 'No se pudo leer el formato. Probá de nuevo.',
  guardar: 'No se pudo guardar. Quedó como estaba.',
  borrar: 'No se pudo borrar el formato. Quedó como estaba.',
}

interface MapeoRow {
  id: string
  nombre: string
  tipo_informe: string
  activo: boolean
  asignaciones: Record<string, string> | null
  muestra: { encabezados: string[]; valores: string[][] } | null
  actualizado_en: string
}

export default async function MapeoColumnasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detalle?: string; ok?: string }>
}) {
  await requerirAcceso('canales')
  const sp = await searchParams

  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('canal_mapeos_columnas')
    .select('id, nombre, tipo_informe, activo, asignaciones, muestra, actualizado_en')
    // Los borradores primero: son lo que alguien vino a resolver.
    .order('activo', { ascending: true })
    .order('actualizado_en', { ascending: false })
    .limit(50)

  const mapeos = (data ?? []) as unknown as MapeoRow[]

  return (
    <Pagina>
      <Encabezado
        titulo="Columnas del informe"
        descripcion="Qué columna del archivo del extranet corresponde a cada dato. Se configura una vez por formato."
        acciones={
          <Link
            href="/panel/canales"
            className="text-sm font-medium text-lago-700 underline"
          >
            Volver a canales
          </Link>
        }
      />

      {sp.error && (
        <Mensaje tono="error">
          {MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}
          {sp.detalle && <span className="mt-1 block font-normal">{sp.detalle}</span>}
        </Mensaje>
      )}
      {sp.ok === 'borrado' && <Mensaje tono="ok">Se borró el formato.</Mensaje>}

      {mapeos.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay ningún formato configurado"
          descripcion="Mientras el sistema reconozca las columnas del informe por sí solo, esta pantalla no hace falta. Aparece un formato acá cuando una importación no pudo interpretar el archivo."
          icono="config"
        />
      ) : (
        <div className="grid gap-4">
          {mapeos.map((m) => {
            const encabezados = m.muestra?.encabezados ?? []
            const valores = m.muestra?.valores ?? []
            const asignado = m.asignaciones ?? {}

            return (
              <Tarjeta
                key={m.id}
                titulo={m.nombre}
                descripcion={
                  m.activo
                    ? 'Formato configurado: las importaciones con estas mismas columnas lo usan solo.'
                    : 'Borrador sin configurar. Decí qué es cada columna y guardalo.'
                }
              >
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {/* Color + texto: nunca solo color. */}
                  <Etiqueta tono={m.activo ? 'exito' : 'alerta'}>
                    {m.activo ? 'En uso' : 'Sin configurar'}
                  </Etiqueta>
                  <span className="text-xs text-stone-500">
                    {encabezados.filter((h) => h !== '').length} columna(s) en el archivo
                  </span>
                </div>

                {encabezados.length === 0 ? (
                  <Mensaje tono="error">
                    Este borrador no guardó los encabezados. Volvé a subir el archivo desde la
                    pantalla de canales para empezar de nuevo.
                  </Mensaje>
                ) : (
                  <form action={guardarMapeo}>
                    <input type="hidden" name="mapeo_id" value={m.id} />

                    <Tabla resumen="Una fila por dato que el importador necesita, con la columna del archivo que le corresponde.">
                      <thead>
                        <tr className={FILA}>
                          <th className={TH}>Dato que el sistema necesita</th>
                          <th className={TH}>Columna del archivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CAMPOS_BOOKING.map((campo) => {
                          const obligatorio = CAMPOS_OBLIGATORIOS.includes(campo)
                          return (
                            <tr key={campo} className={FILA}>
                              <td className={TD}>
                                <span className="font-medium text-stone-800">
                                  {ETIQUETAS_CAMPO[campo]}
                                </span>
                                {obligatorio && (
                                  <span className="ml-2 text-xs font-semibold text-calafate-700">
                                    obligatorio
                                  </span>
                                )}
                              </td>
                              <td className={TD}>
                                <select
                                  name={`campo_${campo}`}
                                  defaultValue={asignado[campo] ?? ''}
                                  aria-label={`Columna del archivo para ${ETIQUETAS_CAMPO[campo]}`}
                                  className="w-full max-w-md rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
                                >
                                  <option value="">— No está en este archivo —</option>
                                  {encabezados.map((h, i) =>
                                    // Las prohibidas llegan en blanco desde el lector y no se
                                    // ofrecen: el sistema no guarda datos de tarjeta, y este
                                    // formulario es justo donde alguien podría asignarlos sin
                                    // darse cuenta.
                                    h === '' ? null : (
                                      <option key={`${h}-${i}`} value={h}>
                                        {h}
                                        {valores[i]?.length
                                          ? `  (ej.: ${valores[i].slice(0, 3).join(' · ')})`
                                          : ''}
                                      </option>
                                    ),
                                  )}
                                </select>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </Tabla>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
                        Guardar este formato
                      </BotonEnvio>
                    </div>
                  </form>
                )}

                <form action={borrarMapeo} className="mt-3">
                  <input type="hidden" name="mapeo_id" value={m.id} />
                  <BotonEnvio
                    variante="fantasma"
                    cargando="Borrando…"
                    confirmar={`Se va a borrar el formato «${m.nombre}». Si después subís un archivo con estas mismas columnas, el sistema va a volver a preguntar. ¿Seguir?`}
                    extra="text-xs"
                  >
                    Borrar este formato
                  </BotonEnvio>
                </form>
              </Tarjeta>
            )
          })}
        </div>
      )}

      <p className="mt-6 text-sm text-stone-500">
        Los cuatro datos marcados como obligatorios son los mínimos para poder importar: sin número
        de reserva no hay forma de evitar duplicados, sin las fechas no hay ocupación, y sin el
        apellido nadie reconoce al huésped en el mostrador.
      </p>
    </Pagina>
  )
}
