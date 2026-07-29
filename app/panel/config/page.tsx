import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'
import { reponerStock } from './actions'

interface ProductoStock {
  id: string
  nombre: string
  categoria: string
  stock: number
  stock_minimo: number
}

interface TarifaRow {
  precio_neto: number | string
  precio_rack: number | string
  tipo: { codigo: string; nombre: string; categoria: CategoriaUnidad; capacidad_max: number } | null
  temporada: { codigo: string; nombre: string; orden: number } | null
}

const ORDEN_TEMP = ['baja', 'media', 'alta']

export default async function ConfigPage() {
  await requerirAcceso('config')
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('tarifas')
    .select(
      'precio_neto, precio_rack, tipo:tipos_unidad(codigo, nombre, categoria, capacidad_max), temporada:temporadas(codigo, nombre, orden)',
    )
  const tarifas = (data ?? []) as unknown as TarifaRow[]

  // tipoCodigo -> { tipo, temporadaCodigo -> {neto, rack} }
  const porTipo = new Map<
    string,
    { nombre: string; categoria: CategoriaUnidad; cap: number; precios: Map<string, { neto: number; rack: number }> }
  >()
  for (const t of tarifas) {
    if (!t.tipo || !t.temporada) continue
    const entry =
      porTipo.get(t.tipo.codigo) ??
      { nombre: t.tipo.nombre, categoria: t.tipo.categoria, cap: t.tipo.capacidad_max, precios: new Map() }
    entry.precios.set(t.temporada.codigo, {
      neto: Number(t.precio_neto),
      rack: Number(t.precio_rack),
    })
    porTipo.set(t.tipo.codigo, entry)
  }

  const filas = [...porTipo.values()].sort((a, b) =>
    a.categoria !== b.categoria ? a.categoria.localeCompare(b.categoria) : a.nombre.localeCompare(b.nombre),
  )

  const { data: productosData } = await supabase
    .from('productos_servicios')
    .select('id, nombre, categoria, stock, stock_minimo')
    .not('stock', 'is', null)
    .order('categoria')
  const inventario = (productosData ?? []) as ProductoStock[]

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Configuración</h1>
      <p className="mt-1 text-sm text-stone-500">
        Tarifario por tipo de unidad y temporada (USD, sin IVA). Neto = agencia · Rack = mostrador.
      </p>

      <div className="mt-5 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Tipo</th>
              <th className="px-4 py-2.5">Cap.</th>
              {ORDEN_TEMP.map((t) => (
                <th key={t} className="px-4 py-2.5 text-center capitalize">
                  {t} (neto / rack)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.nombre} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-medium text-stone-800">{f.nombre}</span>
                  <span className="ml-2 text-xs text-stone-400">{ETIQUETAS_CATEGORIA[f.categoria]}</span>
                </td>
                <td className="px-4 py-2.5 text-stone-600">{f.cap}</td>
                {ORDEN_TEMP.map((t) => {
                  const p = f.precios.get(t)
                  return (
                    <td key={t} className="px-4 py-2.5 text-center text-stone-700">
                      {p ? `${p.neto} / ${p.rack}` : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-stone-400">
        La edición de tarifas y unidades se habilita en una fase posterior.
      </p>

      <h2 className="mt-8 text-lg font-medium text-stone-800">Inventario</h2>
      <p className="mt-1 text-sm text-stone-500">
        Stock de frigobar y amenities; se descuenta al cargar consumos.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Producto</th>
              <th className="px-4 py-2.5 text-right">Stock</th>
              <th className="px-4 py-2.5 text-right">Mínimo</th>
              <th className="px-4 py-2.5">Reponer</th>
            </tr>
          </thead>
          <tbody>
            {inventario.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-stone-400">
                  Sin productos con control de stock.
                </td>
              </tr>
            )}
            {inventario.map((p) => {
              const bajo = p.stock <= p.stock_minimo
              return (
                <tr key={p.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-medium text-stone-800">{p.nombre}</td>
                  <td className={`px-4 py-2 text-right font-medium ${bajo ? 'text-red-600' : 'text-stone-800'}`}>
                    {p.stock}
                    {bajo && <span className="ml-1 text-xs">⚠ bajo</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-stone-500">{p.stock_minimo}</td>
                  <td className="px-4 py-2">
                    <form action={reponerStock} className="flex items-center gap-1">
                      <input type="hidden" name="producto_id" value={p.id} />
                      <input
                        name="cantidad"
                        type="number"
                        min="1"
                        defaultValue={12}
                        className="w-16 rounded-md border border-stone-300 px-2 py-1 text-xs"
                      />
                      <button className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700 transition hover:bg-stone-200">
                        + Reponer
                      </button>
                    </form>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
