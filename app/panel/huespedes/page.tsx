import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'

interface Huesped {
  id: string
  apellido: string
  nombre: string
  email: string | null
  doc_numero: string
  nacionalidad: string | null
}

export default async function HuespedesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requerirAcceso('huespedes')
  const { q } = await searchParams
  const supabase = await crearClienteServidor()

  let query = supabase
    .from('huespedes')
    .select('id, apellido, nombre, email, doc_numero, nacionalidad')
    .order('apellido')
    .limit(200)
  if (q && q.trim()) query = query.ilike('apellido', `%${q.trim()}%`)
  const { data } = await query
  const huespedes = (data ?? []) as Huesped[]

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Huéspedes</h1>
      <p className="mt-1 text-sm text-stone-500">Base de huéspedes e historial.</p>

      <form method="get" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Buscar por apellido…"
          className="w-64 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-sky-600"
        />
        <button className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-900">
          Buscar
        </button>
      </form>

      <div className="mt-5 overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Apellido y nombre</th>
              <th className="px-4 py-2.5">Documento</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Nacionalidad</th>
            </tr>
          </thead>
          <tbody>
            {huespedes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-stone-400">
                  Sin huéspedes.
                </td>
              </tr>
            )}
            {huespedes.map((h) => (
              <tr key={h.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                <td className="px-4 py-2.5">
                  <Link href={`/panel/huespedes/${h.id}`} className="font-medium text-sky-700 hover:underline">
                    {h.apellido}, {h.nombre}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-stone-600">{h.doc_numero || '—'}</td>
                <td className="px-4 py-2.5 text-stone-600">{h.email || '—'}</td>
                <td className="px-4 py-2.5 text-stone-600">{h.nacionalidad || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
