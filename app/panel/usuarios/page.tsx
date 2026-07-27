import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { ROLES, ETIQUETAS_ROL, type Rol } from '@/lib/domain/roles'
import { FormularioUsuario } from './formulario'
import { cambiarRolUsuario, alternarActivoUsuario } from './actions'

interface Perfil {
  id: string
  nombre: string
  rol: Rol
  activo: boolean
}

export default async function UsuariosPage() {
  const sesion = await requerirAcceso('usuarios')
  const admin = crearClienteAdmin()

  const [{ data: perfilesData }, { data: authData }] = await Promise.all([
    admin.from('perfiles').select('id, nombre, rol, activo').order('creado_en'),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])
  const perfiles = (perfilesData ?? []) as Perfil[]
  const emailPorId = new Map(authData.users.map((u) => [u.id, u.email ?? '']))

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Usuarios</h1>
      <p className="mt-1 text-sm text-stone-500">
        Staff del hotel y su nivel de acceso.
      </p>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Nuevo usuario</h2>
        <FormularioUsuario />
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Rol</th>
              <th className="px-4 py-2.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {perfiles.map((p) => {
              const esYo = p.id === sesion.userId
              return (
                <tr key={p.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-stone-800">
                    {p.nombre}
                    {esYo && <span className="ml-2 text-xs text-stone-400">(vos)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">{emailPorId.get(p.id)}</td>
                  <td className="px-4 py-2.5">
                    <form action={cambiarRolUsuario} className="flex items-center gap-2">
                      <input type="hidden" name="user_id" value={p.id} />
                      <select
                        name="rol"
                        defaultValue={p.rol}
                        disabled={esYo}
                        className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:bg-stone-100"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ETIQUETAS_ROL[r]}
                          </option>
                        ))}
                      </select>
                      {!esYo && (
                        <button className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600 hover:bg-stone-200">
                          Guardar
                        </button>
                      )}
                    </form>
                  </td>
                  <td className="px-4 py-2.5">
                    <form action={alternarActivoUsuario}>
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="activo" value={String(p.activo)} />
                      <button
                        disabled={esYo}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium disabled:opacity-60 ${
                          p.activo
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                        }`}
                      >
                        {p.activo ? 'Activo' : 'Inactivo'}
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
