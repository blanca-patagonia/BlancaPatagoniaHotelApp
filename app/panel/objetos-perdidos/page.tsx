import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { FormularioObjeto } from './formulario'
import { marcarDevuelto } from './actions'

interface Objeto {
  id: string
  descripcion: string
  ubicacion: string
  fecha_hallazgo: string
  estado: 'guardado' | 'devuelto'
}

export default async function ObjetosPerdidosPage() {
  await requerirAcceso('objetos_perdidos')
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('objetos_perdidos')
    .select('id, descripcion, ubicacion, fecha_hallazgo, estado')
    .order('fecha_hallazgo', { ascending: false })
  const objetos = (data ?? []) as Objeto[]

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Objetos perdidos</h1>
      <p className="mt-1 text-sm text-stone-500">Registro y devolución de objetos.</p>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <FormularioObjeto />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Objeto</th>
              <th className="px-4 py-2.5">Ubicación</th>
              <th className="px-4 py-2.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {objetos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-stone-400">
                  Sin objetos registrados.
                </td>
              </tr>
            )}
            {objetos.map((o) => (
              <tr key={o.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2 text-stone-500">{o.fecha_hallazgo}</td>
                <td className="px-4 py-2 font-medium text-stone-800">{o.descripcion}</td>
                <td className="px-4 py-2 text-stone-600">{o.ubicacion || '—'}</td>
                <td className="px-4 py-2">
                  {o.estado === 'devuelto' ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                      Devuelto
                    </span>
                  ) : (
                    <form action={marcarDevuelto}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600 transition hover:bg-stone-200">
                        Guardado · marcar devuelto
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
