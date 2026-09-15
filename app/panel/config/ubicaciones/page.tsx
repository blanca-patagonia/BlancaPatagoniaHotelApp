import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { crearUnidad, guardarUbicacionUnidad } from '../actions'
import { registrarFalla } from '@/lib/acciones'
import { CAMPO, Campo, Encabezado, FILA, Mensaje, TD, TH, Tabla, Tarjeta, Pagina } from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

const MENSAJES_ERROR: Record<string, string> = {
  unidad: 'Faltó indicar la unidad.',
  ubicacion: 'No se pudo guardar la ubicación. Quedó como estaba.',
  unidad_nombre: 'Ingresá un nombre para la unidad.',
  unidad_tipo: 'Elegí un tipo de alojamiento válido.',
  unidad_tipo_verificar: 'No se pudo verificar el tipo. No se creó nada.',
  unidad_guardar: 'No se pudo crear la unidad. Probá de nuevo.',
}

/**
 * Ubicación física de cada unidad: bloque, piso y orden de recorrido.
 *
 * El **orden** es el que define el recorrido de limpieza dentro del piso.
 * Existe porque el alfabético pone «10» antes que «9», así que ordenar por
 * nombre manda a la mucama a caminar el pasillo en zigzag.
 */
export default async function UbicacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const supabase = await crearClienteServidor()

  const [{ data, error }, { data: tiposData, error: errorTipos }] = await Promise.all([
    supabase
      .from('unidades')
      .select('id, nombre, piso, bloque, orden, tipo:tipos_unidad(nombre)')
      .eq('activo', true)
      .order('bloque')
      .order('piso')
      .order('orden'),
    supabase.from('tipos_unidad').select('id, nombre').eq('activo', true).order('nombre'),
  ])
  if (error) registrarFalla(error, 'config:ubicaciones')
  if (errorTipos) registrarFalla(errorTipos, 'config:ubicaciones_tipos')

  const unidades = (data ?? []) as unknown as {
    id: string
    nombre: string
    piso: string
    bloque: string
    orden: number
    tipo: { nombre: string } | null
  }[]
  const tipos = (tiposData ?? []) as { id: string; nombre: string }[]

  const sinUbicar = unidades.filter((u) => !u.piso).length

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Ubicación de las unidades"
        descripcion="Bloque, piso y orden de recorrido. Se usan para filtrar la grilla de ocupación y para ordenar el trabajo de limpieza."
        icono="config"
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}</Mensaje>}
      {sp.ok === 'ubicacion' && (
        <Mensaje tono="ok">Ubicación guardada. La grilla ya la usa para filtrar y ordenar.</Mensaje>
      )}
      {sp.ok === 'unidad' && <Mensaje tono="ok">Unidad creada. Ya aparece en la grilla de ocupación.</Mensaje>}
      {error && (
        <Mensaje tono="error">
          No se pudo leer el listado de unidades. Los filtros de la grilla de ocupación pueden
          quedar incompletos.
        </Mensaje>
      )}

      {puedeEditar && (
        <Tarjeta
          titulo="Nueva unidad"
          descripcion="Da de alta una habitación o cabaña física. Después se le puede asignar bloque, piso y orden acá abajo."
          className="mb-4"
        >
          {errorTipos || tipos.length === 0 ? (
            <p className="px-5 py-4 text-sm text-stone-500">
              {errorTipos
                ? 'No se pudo leer el catálogo de tipos de alojamiento. No se puede crear una unidad hasta que se pueda leer.'
                : 'Todavía no hay tipos de alojamiento activos. Cargá uno en el tarifario antes de crear una unidad.'}
            </p>
          ) : (
            <form action={crearUnidad} className="flex flex-wrap items-end gap-3 p-5">
              <Campo etiqueta="Nombre" requerido>
                <input name="nombre" required placeholder="Cabaña 7" className={`${CAMPO} w-48`} />
              </Campo>
              <Campo etiqueta="Tipo de alojamiento" requerido>
                <select name="tipo_unidad_id" required defaultValue="" className={`${CAMPO} w-56`}>
                  <option value="" disabled>
                    Elegir…
                  </option>
                  {tipos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <BotonEnvio cargando="Creando…" extra="w-full sm:w-auto">
                Crear unidad
              </BotonEnvio>
            </form>
          )}
        </Tarjeta>
      )}

      <Tarjeta>
        <div className="p-5">
          {sinUbicar > 0 && (
            <p className="mb-3 rounded-lg bg-lenga-50 px-4 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200">
              {sinUbicar} unidad(es) sin piso cargado. La grilla las muestra igual, pero el filtro por
              piso no las alcanza.
            </p>
          )}

          <div className="overflow-x-auto">
            <Tabla resumen="Unidades con su bloque, piso y orden de recorrido">
              <thead>
                <tr>
                  <th className={TH}>Unidad</th>
                  <th className={TH}>Bloque</th>
                  <th className={TH}>Piso</th>
                  <th className={TH}>Orden</th>
                  {puedeEditar && <th className={TH}>Guardar</th>}
                </tr>
              </thead>
              <tbody>
                {unidades.map((u) => (
                  <tr key={u.id} className={FILA}>
                    {puedeEditar ? (
                      <>
                        <td className={TD}>
                          <span className="font-medium text-stone-800">{u.nombre}</span>
                          <span className="block text-xs text-stone-500">{u.tipo?.nombre}</span>
                        </td>
                        <td className={TD} colSpan={4}>
                          <form
                            action={guardarUbicacionUnidad}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="unidad_id" value={u.id} />
                            <Campo etiqueta="Bloque">
                              <input
                                name="bloque"
                                defaultValue={u.bloque}
                                placeholder="Hostería"
                                className={`${CAMPO} w-40`}
                              />
                            </Campo>
                            <Campo etiqueta="Piso" ayuda="«PB», «1», «Entrepiso».">
                              <input
                                name="piso"
                                defaultValue={u.piso}
                                placeholder="PB"
                                className={`${CAMPO} w-24`}
                              />
                            </Campo>
                            <Campo etiqueta="Orden">
                              <input
                                name="orden"
                                type="number"
                                min={0}
                                defaultValue={u.orden}
                                className={`${CAMPO} w-20`}
                              />
                            </Campo>
                            <BotonEnvio variante="secundario" cargando="Guardando…">
                              Guardar
                            </BotonEnvio>
                          </form>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={TD}>
                          <span className="font-medium text-stone-800">{u.nombre}</span>
                        </td>
                        <td className={`${TD} text-stone-600`}>{u.bloque || '—'}</td>
                        <td className={`${TD} text-stone-600`}>{u.piso || '—'}</td>
                        <td className={`${TD} tabular text-stone-600`}>{u.orden}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </div>
        </div>
      </Tarjeta>
    </Pagina>
  )
}
