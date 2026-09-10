import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { guardarUbicacionUnidad } from '../actions'
import { registrarFalla } from '@/lib/acciones'
import { CAMPO, Campo, Encabezado, FILA, Mensaje, TD, TH, Tabla, Tarjeta, Pagina } from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

const MENSAJES_ERROR: Record<string, string> = {
  unidad: 'Faltó indicar la unidad.',
  ubicacion: 'No se pudo guardar la ubicación. Quedó como estaba.',
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

  const { data, error } = await supabase
    .from('unidades')
    .select('id, nombre, piso, bloque, orden, tipo:tipos_unidad(nombre)')
    .eq('activo', true)
    .order('bloque')
    .order('piso')
    .order('orden')
  if (error) registrarFalla(error, 'config:ubicaciones')

  const unidades = (data ?? []) as unknown as {
    id: string
    nombre: string
    piso: string
    bloque: string
    orden: number
    tipo: { nombre: string } | null
  }[]

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
      {error && (
        <Mensaje tono="error">
          No se pudo leer el listado de unidades. Los filtros de la grilla de ocupación pueden
          quedar incompletos.
        </Mensaje>
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
