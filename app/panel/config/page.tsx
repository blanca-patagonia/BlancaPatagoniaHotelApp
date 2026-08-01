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
} from '../_components/ui'
import { actualizarTarifa, reponerStock } from './actions'

interface ProductoStock {
  id: string
  nombre: string
  categoria: string
  stock: number
  stock_minimo: number
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
  neto_mayor: 'El precio neto (agencia) no puede superar al rack (mostrador).',
  guardar: 'No se pudo guardar la tarifa. Probá de nuevo.',
}

export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const sesion = await requerirAcceso('config')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const puedeEditar = sesion.rol === 'admin' || sesion.rol === 'gerencia'

  const [{ data }, { data: productosData }] = await Promise.all([
    supabase
      .from('tarifas')
      .select(
        'id, precio_neto, precio_rack, tipo:tipos_unidad(codigo, nombre, categoria, capacidad_max), temporada:temporadas(codigo, nombre, orden)',
      ),
    supabase
      .from('productos_servicios')
      .select('id, nombre, categoria, stock, stock_minimo')
      .not('stock', 'is', null)
      .order('categoria'),
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

  const bajos = inventario.filter((p) => p.stock <= p.stock_minimo)

  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado
        titulo="Configuración"
        descripcion="Tarifario por tipo de unidad y temporada, e inventario de consumos."
        icono="config"
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}</Mensaje>}
      {sp.ok === 'tarifa' && <Mensaje tono="ok">Tarifa actualizada.</Mensaje>}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi titulo="Tipos de unidad" valor={String(filas.length)} detalle="en el tarifario" icono="ocupacion" />
        <Kpi titulo="Productos" valor={String(inventario.length)} detalle="con control de stock" icono="objetos" />
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
                    <span className="ml-2 text-xs text-stone-400">
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
        <p className="mt-2 text-xs text-stone-400">
          Tu rol puede consultar el tarifario, pero no modificarlo.
        </p>
      )}

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
                <th className={`${TH} text-right`}>Stock</th>
                <th className={`${TH} text-right`}>Mínimo</th>
                {puedeEditar && <th className={TH}>Reponer</th>}
              </tr>
            </thead>
            <tbody>
              {inventario.map((p) => {
                const bajo = p.stock <= p.stock_minimo
                return (
                  <tr key={p.id} className={FILA}>
                    <td className={`${TD} font-medium text-stone-800`}>{p.nombre}</td>
                    <td className={`${TD} text-stone-500 capitalize`}>{p.categoria}</td>
                    <td className={`${TD} tabular text-right`}>
                      <span className={bajo ? 'font-semibold text-red-600' : 'text-stone-800'}>
                        {p.stock}
                      </span>
                      {bajo && (
                        <span className="ml-2">
                          <Etiqueta tono="peligro">bajo</Etiqueta>
                        </span>
                      )}
                    </td>
                    <td className={`${TD} tabular text-right text-stone-500`}>{p.stock_minimo}</td>
                    {puedeEditar && (
                      <td className={TD}>
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
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
    </div>
  )
}
