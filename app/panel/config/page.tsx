import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import {
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Mensaje,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  CAMPO,
  Campo,
  Pagina,
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import { EVENTOS_EMAIL, PLANTILLAS, renderizar } from '@/lib/domain/plantillas'
import { llevaStock, stockBajo, faltantes as articulosFaltantes } from '@/lib/domain/inventario'
import { obtenerProveedorEmail } from '@/lib/email'
import { actualizarTarifa, reponerStock, crearProducto, alternarProducto } from './actions'
import { CATEGORIAS_PRODUCTO, ETIQUETAS_CATEGORIA_PRODUCTO } from '@/lib/domain/consumos'
import { enviarPlantillaPrueba } from './plantillas-actions'

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
  nivel: 'Oro',
  puntos: 2100,
}

interface ProductoStock {
  id: string
  nombre: string
  categoria: string
  precio: number | string
  stock: number | null
  stock_minimo: number | null
  activo: boolean
}

interface TarifaRow {
  id: string
  precio_neto: number | string
  precio_rack: number | string
  tipo: {
    codigo: string
    nombre: string
    categoria: CategoriaUnidad
    capacidad_max: number
  } | null
  temporada: { codigo: string; nombre: string; orden: number } | null
}

const ORDEN_TEMP = ['baja', 'media', 'alta']

const MENSAJES_ERROR: Record<string, string> = {
  importes: 'Los importes tienen que ser números positivos.',
  producto: 'Revisá el nombre y el precio del producto.',
  neto_mayor: 'El precio neto (agencia) no puede superar al rack (mostrador).',
  guardar: 'No se pudo guardar la tarifa. Probá de nuevo.',
  // Fallos de escritura, antes silenciosos. `producto_estado` no reusa el slug
  // `producto`, que ya significa «revisá los datos del alta».
  producto_estado: 'No se pudo activar ni desactivar el producto. Quedó como estaba.',
  stock: 'No se pudo registrar la reposición. El stock quedó con el valor anterior.',
}

export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; detalle?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const proveedorEmail = obtenerProveedorEmail()

  const [{ data }, { data: productosData }] = await Promise.all([
    supabase
      .from('tarifas')
      .select(
        'id, precio_neto, precio_rack, tipo:tipos_unidad(codigo, nombre, categoria, capacidad_max), temporada:temporadas(codigo, nombre, orden)',
      ),
    supabase
      .from('productos_servicios')
      .select('id, nombre, categoria, precio, stock, stock_minimo, activo')
      .order('categoria')
      .order('nombre'),
  ])

  const tarifas = (data ?? []) as unknown as TarifaRow[]
  const inventario = (productosData ?? []) as ProductoStock[]

  // tipoCodigo -> { datos del tipo, temporadaCodigo -> tarifa }
  const porTipo = new Map<
    string,
    {
      nombre: string
      categoria: CategoriaUnidad
      cap: number
      precios: Map<string, { id: string; neto: number; rack: number }>
    }
  >()
  for (const t of tarifas) {
    if (!t.tipo || !t.temporada) continue
    const entry = porTipo.get(t.tipo.codigo) ?? {
      nombre: t.tipo.nombre,
      categoria: t.tipo.categoria,
      cap: t.tipo.capacidad_max,
      precios: new Map(),
    }
    entry.precios.set(t.temporada.codigo, {
      id: t.id,
      neto: Number(t.precio_neto),
      rack: Number(t.precio_rack),
    })
    porTipo.set(t.tipo.codigo, entry)
  }

  const filas = [...porTipo.values()].sort((a, b) =>
    a.categoria !== b.categoria
      ? a.categoria.localeCompare(b.categoria)
      : a.nombre.localeCompare(b.nombre),
  )

  // Misma función que usa el tablero de inicio: antes cada pantalla escribía su
  // propia condición y los números no coincidían.
  const conStock = inventario.filter(llevaStock)
  const bajos = articulosFaltantes(inventario)

  return (
    <Pagina>
      <Encabezado
        titulo="Configuración"
        descripcion="Tarifario por tipo de unidad y temporada, e inventario de consumos."
        icono="config"
      />

      {sp.error && (
        <Mensaje tono="error">
          {sp.detalle ?? MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}
        </Mensaje>
      )}
      {sp.ok === 'tarifa' && <Mensaje tono="ok">Tarifa actualizada.</Mensaje>}
      {sp.ok === 'producto' && <Mensaje tono="ok">Producto agregado al catálogo.</Mensaje>}
      {sp.ok === 'envio' && <Mensaje tono="ok">{sp.detalle ?? 'Correo procesado.'}</Mensaje>}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi titulo="Tipos de unidad" valor={String(filas.length)} detalle="en el tarifario" icono="ocupacion" />
        <Kpi titulo="Productos" valor={String(conStock.length)} detalle="con control de stock" icono="objetos" />
        <Kpi
          titulo="Stock bajo"
          valor={String(bajos.length)}
          detalle="requieren reposición"
          icono="alerta"
          tono={bajos.length > 0 ? 'peligro' : 'exito'}
        />
      </div>

      <Tarjeta
        titulo="Tarifario"
        descripcion="Precios en USD sin IVA · Neto = agencia · Rack = mostrador"
        className="overflow-hidden"
        acciones={
          /* Tener precios no alcanza: si la fecha de la reserva no cae en
             ninguna temporada, no hay tarifa que aplicar. Esa pantalla estaba
             ausente y el sistema fallaba sin explicar por qué. */
          <Link href="/panel/config/temporadas" className={botonClases('secundario')}>
            Fechas de cada temporada
          </Link>
        }
      >
        {filas.length === 0 ? (
          <EstadoVacio titulo="No hay tarifas cargadas" icono="config" />
        ) : (
          <Tabla resumen="Tarifas por tipo de unidad y temporada, con precio neto y rack">
            <thead>
              <tr>
                <th className={TH}>Tipo</th>
                <th className={TH}>Cap.</th>
                {ORDEN_TEMP.map((t) => (
                  <th key={t} className={`${TH} text-center`}>
                    Temporada {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.nombre} className={FILA}>
                  <td className={TD}>
                    <span className="font-medium text-stone-800">{f.nombre}</span>
                    <span className="ml-2 text-xs text-stone-600">
                      {ETIQUETAS_CATEGORIA[f.categoria]}
                    </span>
                  </td>
                  <td className={`${TD} tabular text-stone-600`}>{f.cap}</td>
                  {ORDEN_TEMP.map((t) => {
                    const p = f.precios.get(t)
                    if (!p) {
                      return (
                        <td key={t} className={`${TD} text-center text-stone-300`}>
                          —
                        </td>
                      )
                    }
                    if (!puedeEditar) {
                      return (
                        <td key={t} className={`${TD} tabular text-center text-stone-700`}>
                          {p.neto} / {p.rack}
                        </td>
                      )
                    }
                    return (
                      <td key={t} className={`${TD} text-center`}>
                        <form
                          action={actualizarTarifa}
                          className="flex items-center justify-center gap-1"
                        >
                          <input type="hidden" name="tarifa_id" value={p.id} />
                          <input
                            type="number"
                            name="precio_neto"
                            defaultValue={p.neto}
                            min="0"
                            step="1"
                            aria-label={`Precio neto de ${f.nombre} en temporada ${t}`}
                            className="tabular w-20 rounded-md border border-stone-300 px-1.5 py-1 text-right text-xs focus:border-lago-500 focus:outline-none"
                          />
                          <span className="text-stone-300">/</span>
                          <input
                            type="number"
                            name="precio_rack"
                            defaultValue={p.rack}
                            min="0"
                            step="1"
                            aria-label={`Precio rack de ${f.nombre} en temporada ${t}`}
                            className="tabular w-20 rounded-md border border-stone-300 px-1.5 py-1 text-right text-xs focus:border-lago-500 focus:outline-none"
                          />
                          <button
                            className={botonClases('secundario', 'px-2 py-1 text-xs')}
                            aria-label={`Guardar tarifa de ${f.nombre} en temporada ${t}`}
                          >
                            OK
                          </button>
                        </form>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      {!puedeEditar && (
        <p className="mt-2 text-xs text-stone-600">
          Tu rol puede consultar el tarifario, pero no modificarlo.
        </p>
      )}

      {/* Plantillas de comunicaciones al huésped. */}
      <Tarjeta
        titulo="Plantillas de correo"
        descripcion={
          proveedorEmail.esReal()
            ? 'Comunicaciones automáticas al huésped.'
            : 'Comunicaciones al huésped · proveedor simulado: los correos NO se envían.'
        }
        className="mt-6"
      >
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
                  <p className="mt-3 text-xs tracking-wide text-stone-600 uppercase">Cuerpo</p>
                  <p className="mt-1 text-sm whitespace-pre-line text-stone-700">{vista.cuerpo}</p>
                  <p className="mt-3 text-xs text-stone-600">
                    Variables: {plantilla.variables.join(', ')}
                  </p>
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

      <Tarjeta
        titulo="Inventario"
        descripcion="Stock de frigobar y amenities; se descuenta solo al cargar un consumo."
        className="mt-6 overflow-hidden"
      >
        {inventario.length === 0 ? (
          <EstadoVacio titulo="Sin productos con control de stock" icono="objetos" />
        ) : (
          <Tabla resumen="Productos con su stock actual, mínimo y reposición">
            <thead>
              <tr>
                <th className={TH}>Producto</th>
                <th className={TH}>Categoría</th>
                <th className={`${TH} text-right`}>Precio</th>
                <th className={`${TH} text-right`}>Stock</th>
                <th className={TH}>Estado</th>
                {puedeEditar && <th className={TH}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {inventario.map((p) => {
                // Un servicio (una excursión, un traslado) no lleva stock: la
                // columna viene en null. Las dos reglas salen del dominio.
                const controla = llevaStock(p)
                const bajo = stockBajo(p)
                return (
                  <tr key={p.id} className={`${FILA} ${p.activo ? '' : 'opacity-50'}`}>
                    <td className={`${TD} font-medium text-stone-800`}>{p.nombre}</td>
                    <td className={`${TD} text-stone-500 capitalize`}>{p.categoria}</td>
                    <td className={`${TD} tabular text-right text-stone-700`}>
                      {Number(p.precio).toLocaleString('es-AR')}
                    </td>
                    <td className={`${TD} tabular text-right`}>
                      {controla ? (
                        <>
                          <span className={bajo ? 'font-semibold text-red-600' : 'text-stone-800'}>
                            {p.stock}
                          </span>
                          <span className="ml-1 text-xs text-stone-600">
                            / mín. {p.stock_minimo ?? 0}
                          </span>
                          {bajo && (
                            <span className="ml-2">
                              <Etiqueta tono="peligro">bajo</Etiqueta>
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-stone-600">servicio</span>
                      )}
                    </td>
                    <td className={TD}>
                      {p.activo ? (
                        <Etiqueta tono="exito">Activo</Etiqueta>
                      ) : (
                        <Etiqueta tono="neutro">Inactivo</Etiqueta>
                      )}
                    </td>
                    {puedeEditar && (
                      <td className={TD}>
                        <div className="flex flex-wrap items-center gap-2">
                          {controla && (
                            <form action={reponerStock} className="flex items-center gap-1">
                              <input type="hidden" name="producto_id" value={p.id} />
                              <input
                                name="cantidad"
                                type="number"
                                min="1"
                                defaultValue={12}
                                aria-label={`Unidades a reponer de ${p.nombre}`}
                                className="tabular w-16 rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                              />
                              <button className={botonClases('secundario', 'px-2 py-1 text-xs')}>
                                + Reponer
                              </button>
                            </form>
                          )}
                          {/* Se desactiva en lugar de borrar: los consumos ya
                              cargados siguen apuntando al producto. */}
                          <form action={alternarProducto}>
                            <input type="hidden" name="producto_id" value={p.id} />
                            <input type="hidden" name="activo" value={String(p.activo)} />
                            <button className={botonClases('secundario', 'px-2 py-1 text-xs')}>
                              {p.activo ? 'Desactivar' : 'Activar'}
                            </button>
                          </form>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </Tabla>
        )}

        {puedeEditar && (
          <form
            action={crearProducto}
            className="grid gap-x-4 gap-y-4 border-t border-stone-100 p-5 sm:grid-cols-6"
          >
            {/* Antes los cinco campos se identificaban solo por su placeholder
                —"Precio USD", "Stock", "Mínimo"—, que desaparece al escribir. */}
            <div className="sm:col-span-3">
              <Campo etiqueta="Nombre del producto" requerido>
                <input name="nombre" required className={CAMPO} />
              </Campo>
            </div>
            <div className="sm:col-span-3">
              <Campo etiqueta="Categoría">
                <select name="categoria" defaultValue="frigobar" className={CAMPO}>
                  {CATEGORIAS_PRODUCTO.map((c) => (
                    <option key={c} value={c}>
                      {ETIQUETAS_CATEGORIA_PRODUCTO[c]}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <div className="sm:col-span-2">
              <Campo etiqueta="Precio (USD)" requerido>
                <input
                  name="precio"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  className={`tabular ${CAMPO}`}
                />
              </Campo>
            </div>
            <div className="sm:col-span-2">
              <Campo etiqueta="Stock inicial">
                <input
                  name="stock"
                  type="number"
                  min="0"
                  defaultValue={0}
                  className={`tabular ${CAMPO}`}
                />
              </Campo>
            </div>
            <div className="sm:col-span-2">
              <Campo
                etiqueta="Stock mínimo"
                ayuda="Por debajo de esto, el tablero avisa que hay que reponer."
              >
                <input
                  name="stock_minimo"
                  type="number"
                  min="0"
                  defaultValue={0}
                  className={`tabular ${CAMPO}`}
                />
              </Campo>
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-6">
              <input
                type="checkbox"
                name="controla_stock"
                value="1"
                defaultChecked
                className="size-4 accent-lago-600"
              />
              Lleva control de stock
              <span className="text-stone-500">(desmarcá si es un servicio)</span>
            </label>
            <div className="sm:col-span-6">
              <BotonEnvio variante="secundario" cargando="Agregando…">
                <Icono nombre="mas" tam={16} />
                Agregar al catálogo
              </BotonEnvio>
            </div>
          </form>
        )}
      </Tarjeta>
    </Pagina>
  )
}
