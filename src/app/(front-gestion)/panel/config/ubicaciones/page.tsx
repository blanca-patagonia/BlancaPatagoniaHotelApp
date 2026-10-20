import Link from 'next/link'
import { esDireccion } from '@/lib/domain/permisos'
import { mensajeDe } from '@/lib/listados'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { guardarUbicacionUnidad, alternarActivoUnidad } from '../unidades.actions'
import { Icono } from '../../_components/iconos'
import { registrarFalla } from '@/lib/acciones'
import { CAMPO, Campo, Etiqueta, Encabezado, FILA, Mensaje, TD, TH, Tabla, Tarjeta, Pagina, botonClases } from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

const MENSAJES_ERROR: Record<string, string> = {
  unidad: 'Faltó indicar la unidad.',
  ubicacion: 'No se pudo guardar la ubicación. Quedó como estaba.',
  unidad_verificar: 'No se pudo verificar si la unidad está ocupada. No se cambió nada.',
  unidad_ocupada:
    'No se puede dar de baja: tiene una estadía pendiente, confirmada, pagada o en curso. Mudá esa reserva a otra unidad primero.',
  unidad_estado: 'No se pudo cambiar el estado de la unidad. Quedó como estaba.',
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
  const puedeEditar = esDireccion(sesion.rol)
  const supabase = await crearClienteServidor()

  const [{ data, error }] = await Promise.all([
    supabase
      .from('unidades')
      .select('id, nombre, piso, bloque, orden, activo, tipo:tipos_unidad(nombre)')
      // Las inactivas se muestran igual, al final: de otro modo no habría
      // forma de reactivar una unidad dada de baja por error desde esta misma
      // pantalla, ni de ver que existe.
      .order('activo', { ascending: false })
      .order('bloque')
      .order('piso')
      .order('orden'),
  ])
  if (error) registrarFalla(error, 'config:ubicaciones')

  const unidades = (data ?? []) as unknown as {
    id: string
    nombre: string
    piso: string
    bloque: string
    orden: number
    activo: boolean
    tipo: { nombre: string } | null
  }[]

  const sinUbicar = unidades.filter((u) => u.activo && !u.piso).length

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
        acciones={
          puedeEditar && (
            <Link href="/panel/config/ubicaciones/nuevo" className={botonClases('primario')}>
              <Icono nombre="mas" tam={16} />
              Nueva unidad
            </Link>
          )
        }
      />

      {sp.error && <Mensaje tono="error">{mensajeDe(MENSAJES_ERROR, sp.error, 'No se pudo completar la operación.')}</Mensaje>}
      {(error) && (
        <Mensaje tono="error">
          No se pudieron leer las unidades: la lista de abajo puede estar incompleta o vacía sin que eso signifique que no haya unidades cargadas. Recargá antes de crear una nueva.
        </Mensaje>
      )}
      {sp.ok === 'ubicacion' && (
        <Mensaje tono="ok">Ubicación guardada. La grilla ya la usa para filtrar y ordenar.</Mensaje>
      )}
      {sp.ok === 'unidad' && <Mensaje tono="ok">Unidad creada. Ya aparece en la grilla de ocupación.</Mensaje>}
      {sp.ok === 'unidad_dada_de_baja' && (
        <Mensaje tono="ok">Unidad dada de baja. Deja de verse en la grilla y en el alta de reservas.</Mensaje>
      )}
      {sp.ok === 'unidad_activada' && <Mensaje tono="ok">Unidad reactivada.</Mensaje>}
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
            <Tabla resumen="Unidades con su nombre, bloque, piso y orden de recorrido">
              <thead>
                <tr>
                  <th className={TH}>Unidad</th>
                  <th className={TH}>Bloque</th>
                  <th className={TH}>Piso</th>
                  <th className={TH}>Orden</th>
                  {puedeEditar && (
                    <>
                      <th className={TH}>Guardar</th>
                      <th className={TH}>
                        <span className="sr-only">Baja / reactivar</span>
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {unidades.map((u) => (
                  <tr key={u.id} className={`${FILA} ${u.activo ? '' : 'opacity-60'}`}>
                    {puedeEditar ? (
                      <>
                        <td className={TD}>
                          <span className="block text-xs text-stone-500">{u.tipo?.nombre}</span>
                          {!u.activo && (
                            <Etiqueta tono="alerta">De baja</Etiqueta>
                          )}
                        </td>
                        <td className={TD} colSpan={4}>
                          <form
                            action={guardarUbicacionUnidad}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="unidad_id" value={u.id} />
                            <Campo etiqueta="Nombre">
                              <input
                                name="nombre"
                                defaultValue={u.nombre}
                                required
                                className={`${CAMPO} w-36`}
                              />
                            </Campo>
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
                        <td className={TD}>
                          <form action={alternarActivoUnidad}>
                            <input type="hidden" name="unidad_id" value={u.id} />
                            <input type="hidden" name="activo" value={u.activo ? '0' : '1'} />
                            <BotonEnvio
                              variante="fantasma"
                              cargando="…"
                              confirmar={
                                u.activo
                                  ? `¿Dar de baja «${u.nombre}»? Deja de verse en la grilla y en el alta de reservas.`
                                  : undefined
                              }
                            >
                              {u.activo ? 'Dar de baja' : 'Reactivar'}
                            </BotonEnvio>
                          </form>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={TD}>
                          <span className="font-medium text-stone-800">{u.nombre}</span>
                          {!u.activo && (
                            <Etiqueta tono="alerta">De baja</Etiqueta>
                          )}
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
