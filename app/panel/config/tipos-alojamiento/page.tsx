import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { crearTipoUnidad, editarTipoUnidad, alternarActivoTipoUnidad } from '../actions'
import { registrarFalla } from '@/lib/acciones'
import { CATEGORIAS_UNIDAD, ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import {
  CAMPO,
  Campo,
  Etiqueta,
  Encabezado,
  FILA,
  Mensaje,
  TD,
  TH,
  Tabla,
  Tarjeta,
  Pagina,
} from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'

const MENSAJES_ERROR: Record<string, string> = {
  tipo_codigo: 'El código solo puede tener mayúsculas, números y guiones (por ejemplo HOST-STD).',
  tipo_codigo_repetido: 'Ya existe un tipo con ese código.',
  tipo_nombre: 'Ingresá un nombre.',
  tipo_categoria: 'Elegí Hostería o Cabaña.',
  tipo_capacidad: 'La capacidad tiene que ser 1 o más.',
  tipo_guardar: 'No se pudo guardar. Probá de nuevo.',
}

interface TipoFila {
  id: string
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  capacidad_max: number
  descripcion: string
  activo: boolean
}

/**
 * Alta y edición de los tipos de alojamiento (categoría comercial: Hostería /
 * Cabaña, con su capacidad y descripción). Hasta ahora el único camino para
 * esto era una migración SQL — así nació el inventario completo (0106-0108) —,
 * así que el hotel no podía sumar un tipo nuevo ni corregir una descripción sin
 * pedírselo a quien tocara el código.
 *
 * El código (`HOST-STD`, `CAB-ONELLI`...) no se edita desde acá a propósito:
 * es la clave que usan el mapa de fotos (`lib/domain/catalogo.ts`) y los
 * mapeos de canal. Ver el comentario de `editarTipoUnidad`.
 */
export default async function TiposAlojamientoPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string
    ok?: string
    alta_codigo?: string
    alta_nombre?: string
    alta_categoria?: string
    alta_capacidad?: string
    alta_descripcion?: string
    edita_id?: string
    edita_nombre?: string
    edita_capacidad?: string
    edita_descripcion?: string
  }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const supabase = await crearClienteServidor()

  const [{ data, error }, { data: unidadesData, error: errorUnidades }] = await Promise.all([
    supabase
      .from('tipos_unidad')
      .select('id, codigo, nombre, categoria, capacidad_max, descripcion, activo')
      .order('activo', { ascending: false })
      .order('categoria')
      .order('nombre'),
    supabase.from('unidades').select('tipo_unidad_id').eq('activo', true),
  ])
  if (error) registrarFalla(error, 'config:tipos_alojamiento')
  if (errorUnidades) registrarFalla(errorUnidades, 'config:tipos_alojamiento_unidades')

  const tipos = (data ?? []) as TipoFila[]
  const unidadesPorTipo = new Map<string, number>()
  for (const u of (unidadesData ?? []) as { tipo_unidad_id: string }[]) {
    unidadesPorTipo.set(u.tipo_unidad_id, (unidadesPorTipo.get(u.tipo_unidad_id) ?? 0) + 1)
  }

  return (
    <Pagina>
      <Link
        href="/panel/config"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a configuración
      </Link>

      <Encabezado
        titulo="Tipos de alojamiento"
        descripcion="Las categorías comerciales (Hostería / Cabaña) con su capacidad y descripción. No son las unidades físicas: eso es «Ubicación de las unidades»."
        icono="config"
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}</Mensaje>}
      {sp.ok === 'tipo_creado' && <Mensaje tono="ok">Tipo de alojamiento creado.</Mensaje>}
      {sp.ok === 'tipo_editado' && <Mensaje tono="ok">Cambios guardados.</Mensaje>}
      {sp.ok === 'tipo_dado_de_baja' && (
        <Mensaje tono="ok">Dado de baja. Deja de ofrecerse en el catálogo público y al crear una unidad.</Mensaje>
      )}
      {sp.ok === 'tipo_activado' && <Mensaje tono="ok">Reactivado.</Mensaje>}
      {error && (
        <Mensaje tono="error">
          No se pudo leer el listado de tipos. Puede estar incompleto — no tomes esto como la lista
          completa todavía.
        </Mensaje>
      )}

      {puedeEditar && (
        <Tarjeta
          titulo="Nuevo tipo de alojamiento"
          descripcion="El código no se puede cambiar después: queda fijo como clave de las fotos y de los canales de venta."
          className="mb-4"
        >
          <form action={crearTipoUnidad} className="flex flex-wrap items-end gap-3 p-5">
            <Campo etiqueta="Código" ayuda="Mayúsculas, números y guiones." requerido>
              <input
                name="codigo"
                required
                defaultValue={sp.alta_codigo ?? ''}
                placeholder="HOST-DELUXE"
                className={`${CAMPO} w-36`}
              />
            </Campo>
            <Campo etiqueta="Nombre" requerido>
              <input
                name="nombre"
                required
                defaultValue={sp.alta_nombre ?? ''}
                placeholder="Deluxe"
                className={`${CAMPO} w-40`}
              />
            </Campo>
            <Campo etiqueta="Categoría" requerido>
              <select name="categoria" required defaultValue={sp.alta_categoria ?? ''} className={`${CAMPO} w-40`}>
                <option value="" disabled>
                  Elegir…
                </option>
                {CATEGORIAS_UNIDAD.map((c) => (
                  <option key={c} value={c}>
                    {ETIQUETAS_CATEGORIA[c]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Capacidad máx." requerido>
              <input
                name="capacidad_max"
                type="number"
                min={1}
                required
                defaultValue={sp.alta_capacidad ?? 2}
                className={`${CAMPO} w-24`}
              />
            </Campo>
            <Campo etiqueta="Descripción">
              <input
                name="descripcion"
                defaultValue={sp.alta_descripcion ?? ''}
                placeholder="Para el catálogo público"
                className={`${CAMPO} w-full sm:w-64`}
              />
            </Campo>
            <BotonEnvio cargando="Creando…" extra="w-full sm:w-auto">
              Crear tipo
            </BotonEnvio>
          </form>
        </Tarjeta>
      )}

      <Tarjeta>
        <div className="overflow-x-auto p-5">
          <Tabla resumen="Tipos de alojamiento con categoría, capacidad y descripción">
            <thead>
              <tr>
                <th className={TH}>Tipo</th>
                <th className={TH}>Categoría</th>
                <th className={TH}>Unidades</th>
                {puedeEditar && <th className={TH}>Editar</th>}
                {puedeEditar && (
                  <th className={TH}>
                    <span className="sr-only">Baja / reactivar</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.id} className={`${FILA} ${t.activo ? '' : 'opacity-60'}`}>
                  <td className={TD}>
                    <span className="font-medium text-stone-800">{t.nombre}</span>
                    <span className="block text-xs text-stone-500">{t.codigo}</span>
                    {!t.activo && <Etiqueta tono="alerta">De baja</Etiqueta>}
                  </td>
                  <td className={`${TD} text-stone-600`}>{ETIQUETAS_CATEGORIA[t.categoria]}</td>
                  <td className={`${TD} tabular text-stone-600`}>{unidadesPorTipo.get(t.id) ?? 0}</td>
                  {puedeEditar ? (
                    <>
                      <td className={TD}>
                        <form action={editarTipoUnidad} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="tipo_id" value={t.id} />
                          <Campo etiqueta="Nombre">
                            <input
                              name="nombre"
                              defaultValue={sp.edita_id === t.id ? sp.edita_nombre : t.nombre}
                              required
                              className={`${CAMPO} w-36`}
                            />
                          </Campo>
                          <Campo etiqueta="Capacidad máx.">
                            <input
                              name="capacidad_max"
                              type="number"
                              min={1}
                              defaultValue={sp.edita_id === t.id ? sp.edita_capacidad : t.capacidad_max}
                              className={`${CAMPO} w-20`}
                            />
                          </Campo>
                          <Campo etiqueta="Descripción">
                            <input
                              name="descripcion"
                              defaultValue={sp.edita_id === t.id ? sp.edita_descripcion : t.descripcion}
                              className={`${CAMPO} w-56`}
                            />
                          </Campo>
                          <BotonEnvio variante="secundario" cargando="Guardando…">
                            Guardar
                          </BotonEnvio>
                        </form>
                      </td>
                      <td className={TD}>
                        <form action={alternarActivoTipoUnidad}>
                          <input type="hidden" name="tipo_id" value={t.id} />
                          <input type="hidden" name="activo" value={t.activo ? '0' : '1'} />
                          <BotonEnvio
                            variante="fantasma"
                            cargando="…"
                            confirmar={
                              t.activo
                                ? `¿Dar de baja «${t.nombre}»? Deja de ofrecerse en el catálogo público y al crear una unidad. Las unidades y tarifas que ya tiene no se tocan.`
                                : undefined
                            }
                          >
                            {t.activo ? 'Dar de baja' : 'Reactivar'}
                          </BotonEnvio>
                        </form>
                      </td>
                    </>
                  ) : (
                    <td className={`${TD} text-stone-600`}>{t.descripcion || '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </Tabla>
        </div>
      </Tarjeta>
    </Pagina>
  )
}
