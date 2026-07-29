import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { FormularioOrden } from './formulario'
import { cambiarEstadoOrden } from './actions'

type Prioridad = 'baja' | 'media' | 'alta'
type EstadoM = 'pendiente' | 'en_proceso' | 'resuelta'

const COLOR_PRIORIDAD: Record<Prioridad, string> = {
  baja: 'bg-stone-100 text-stone-600',
  media: 'bg-amber-100 text-amber-800',
  alta: 'bg-red-100 text-red-700',
}
const ETIQUETA_ESTADO: Record<EstadoM, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  resuelta: 'Resuelta',
}
const SIGUIENTE: Record<EstadoM, { estado: EstadoM; label: string } | null> = {
  pendiente: { estado: 'en_proceso', label: 'Tomar' },
  en_proceso: { estado: 'resuelta', label: 'Resolver' },
  resuelta: null,
}

interface Orden {
  id: string
  titulo: string
  descripcion: string
  prioridad: Prioridad
  estado: EstadoM
  unidad: { nombre: string } | null
}

export default async function MantenimientoPage() {
  await requerirAcceso('mantenimiento')
  const supabase = await crearClienteServidor()
  const [{ data: ordenesData }, { data: unidadesData }] = await Promise.all([
    supabase
      .from('ordenes_mantenimiento')
      .select('id, titulo, descripcion, prioridad, estado, unidad:unidades(nombre)')
      .order('creada_en', { ascending: false }),
    supabase.from('unidades').select('id, nombre').eq('activo', true).order('nombre'),
  ])
  const ordenes = (ordenesData ?? []) as unknown as Orden[]
  const unidades = (unidadesData ?? []) as { id: string; nombre: string }[]

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Mantenimiento</h1>
      <p className="mt-1 text-sm text-stone-500">Órdenes de trabajo por unidad.</p>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Nueva orden</h2>
        <FormularioOrden unidades={unidades} />
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {ordenes.length === 0 && (
          <p className="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-400">
            Sin órdenes de mantenimiento.
          </p>
        )}
        {ordenes.map((o) => {
          const sig = SIGUIENTE[o.estado]
          return (
            <div
              key={o.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 ${o.estado === 'resuelta' ? 'opacity-60' : ''}`}
            >
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_PRIORIDAD[o.prioridad]}`}>
                {o.prioridad}
              </span>
              <div className="min-w-40 flex-1">
                <p className="font-medium text-stone-800">{o.titulo}</p>
                <p className="text-xs text-stone-400">
                  {o.unidad?.nombre ?? 'General'}
                  {o.descripcion ? ` · ${o.descripcion}` : ''}
                </p>
              </div>
              <span className="text-xs text-stone-500">{ETIQUETA_ESTADO[o.estado]}</span>
              {sig && (
                <form action={cambiarEstadoOrden}>
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="estado" value={sig.estado} />
                  <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-900">
                    {sig.label}
                  </button>
                </form>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
