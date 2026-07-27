import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_CATEGORIA, type CategoriaUnidad } from '@/lib/domain/unidades'

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
    </div>
  )
}
