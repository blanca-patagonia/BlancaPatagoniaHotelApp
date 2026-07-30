import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { FormularioAviso } from './formulario'
import { borrarAviso } from './actions'

interface Aviso {
  id: string
  mensaje: string
  creado_en: string
  autor_id: string | null
  autor: { nombre: string } | null
}

export default async function AvisosPage() {
  const sesion = await requerirAcceso('avisos')
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('avisos')
    .select('id, mensaje, creado_en, autor_id, autor:perfiles(nombre)')
    .order('creado_en', { ascending: false })
    .limit(100)
  const avisos = (data ?? []) as unknown as Aviso[]

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Avisos</h1>
      <p className="mt-1 text-sm text-stone-500">Mensajería interna del equipo.</p>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <FormularioAviso />
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {avisos.length === 0 && (
          <p className="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-400">
            Sin avisos.
          </p>
        )}
        {avisos.map((a) => {
          const puedeBorrar = a.autor_id === sesion.userId || sesion.rol === 'admin'
          return (
            <div key={a.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-stone-800">{a.mensaje}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-stone-400">
                <span>
                  {a.autor?.nombre ?? 'Staff'} · {new Date(a.creado_en).toLocaleString('es-AR')}
                </span>
                {puedeBorrar && (
                  <form action={borrarAviso}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-stone-400 transition hover:text-red-600">Borrar</button>
                  </form>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
