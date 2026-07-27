import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ESTADOS_HK,
  ETIQUETAS_ESTADO_HK,
  type EstadoHousekeeping,
} from '@/lib/domain/unidades'
import { cambiarEstadoUnidad } from './actions'

const COLOR_HK: Record<EstadoHousekeeping, string> = {
  limpia: 'bg-emerald-500',
  sucia: 'bg-amber-500',
  inspeccionada: 'bg-sky-500',
  bloqueada: 'bg-red-500',
}

interface UnidadRow {
  id: string
  nombre: string
  estado: EstadoHousekeeping
  tipo: { nombre: string } | null
}

export default async function HousekeepingPage() {
  await requerirAcceso('housekeeping')
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('unidades')
    .select('id, nombre, estado, tipo:tipos_unidad(nombre)')
    .eq('activo', true)
    .order('nombre')
  const unidades = (data ?? []) as unknown as UnidadRow[]

  const conteo = new Map<EstadoHousekeeping, number>()
  for (const u of unidades) conteo.set(u.estado, (conteo.get(u.estado) ?? 0) + 1)

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Housekeeping</h1>
      <p className="mt-1 text-sm text-stone-500">Estado de limpieza de cada unidad.</p>

      <div className="mt-4 flex flex-wrap gap-3">
        {ESTADOS_HK.map((e) => (
          <div key={e} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_HK[e]}`} />
            <span className="font-medium text-stone-800">{conteo.get(e) ?? 0}</span>
            <span className="text-stone-500">{ETIQUETAS_ESTADO_HK[e]}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-stone-200 bg-white">
        {unidades.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-0"
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_HK[u.estado]}`} />
            <div className="min-w-40 flex-1">
              <p className="font-medium text-stone-800">{u.nombre}</p>
              <p className="text-xs text-stone-400">{u.tipo?.nombre}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ESTADOS_HK.map((e) => (
                <form key={e} action={cambiarEstadoUnidad}>
                  <input type="hidden" name="unidad_id" value={u.id} />
                  <input type="hidden" name="estado" value={e} />
                  <button
                    disabled={u.estado === e}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      u.estado === e
                        ? 'bg-stone-800 text-white'
                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    }`}
                  >
                    {ETIQUETAS_ESTADO_HK[e]}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
