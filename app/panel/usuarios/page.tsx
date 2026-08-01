import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { ROLES, ETIQUETAS_ROL, type Rol } from '@/lib/domain/roles'
import {
  BarraHerramientas,
  Buscador,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../_components/ui'
import { FormularioUsuario } from './formulario'
import { cambiarRolUsuario, alternarActivoUsuario } from './actions'

interface Perfil {
  id: string
  nombre: string
  rol: Rol
  activo: boolean
}

/** Último acceso en formato corto; distingue a quien nunca entró. */
function ultimoAcceso(iso: string | undefined): string {
  if (!iso) return 'nunca'
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 30) return `hace ${dias} días`
  return new Date(iso).toLocaleDateString('es-AR')
}

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const sesion = await requerirAcceso('usuarios')
  const { q } = await searchParams
  const admin = crearClienteAdmin()

  const [{ data: perfilesData }, { data: authData }] = await Promise.all([
    admin.from('perfiles').select('id, nombre, rol, activo').order('creado_en'),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])
  const perfiles = (perfilesData ?? []) as Perfil[]
  const emailPorId = new Map(authData.users.map((u) => [u.id, u.email ?? '']))
  const accesoPorId = new Map(authData.users.map((u) => [u.id, u.last_sign_in_at ?? undefined]))

  // El listado es chico (staff del hotel): se filtra en memoria sin ir a la base.
  const termino = (q ?? '').trim().toLowerCase()
  const visibles = termino
    ? perfiles.filter(
        (p) =>
          p.nombre.toLowerCase().includes(termino) ||
          (emailPorId.get(p.id) ?? '').toLowerCase().includes(termino),
      )
    : perfiles

  const activos = perfiles.filter((p) => p.activo).length

  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado
        titulo="Usuarios"
        descripcion="Staff del hotel y su nivel de acceso al sistema."
        icono="usuarios"
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi titulo="Usuarios" valor={String(perfiles.length)} detalle="dados de alta" icono="usuarios" />
        <Kpi titulo="Activos" valor={String(activos)} detalle="pueden ingresar" icono="ok" tono="exito" />
        <Kpi
          titulo="Inactivos"
          valor={String(perfiles.length - activos)}
          detalle="acceso suspendido"
          icono="alerta"
          tono="neutro"
        />
        <Kpi
          titulo="Administradores"
          valor={String(perfiles.filter((p) => p.rol === 'admin').length)}
          detalle="acceso total"
          icono="config"
          tono="calafate"
        />
      </div>

      <BarraHerramientas>
        <Buscador
          accion="/panel/usuarios"
          valor={q}
          etiqueta="Buscar usuarios"
          placeholder="Nombre o email…"
        />
        {q && (
          <Link href="/panel/usuarios" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      <details className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-stone-700 marker:text-lago-600">
          Dar de alta un usuario
        </summary>
        <div className="border-t border-stone-100 p-5">
          <FormularioUsuario />
        </div>
      </details>

      <Tarjeta className="overflow-hidden">
        {visibles.length === 0 ? (
          <EstadoVacio
            titulo="Ningún usuario coincide con la búsqueda"
            descripcion="Se busca por nombre o por email."
            icono="usuarios"
          />
        ) : (
          <Tabla resumen="Usuarios del staff con su email, rol, último acceso y estado">
            <thead>
              <tr>
                <th className={TH}>Nombre</th>
                <th className={TH}>Email</th>
                <th className={TH}>Último acceso</th>
                <th className={TH}>Rol</th>
                <th className={TH}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const esYo = p.id === sesion.userId
                return (
                  <tr key={p.id} className={FILA}>
                    <td className={`${TD} font-medium text-stone-800`}>
                      {p.nombre}
                      {esYo && <span className="ml-2 text-xs text-stone-400">(vos)</span>}
                    </td>
                    <td className={`${TD} text-stone-600`}>{emailPorId.get(p.id)}</td>
                    <td className={`${TD} text-stone-500`}>{ultimoAcceso(accesoPorId.get(p.id))}</td>
                    <td className={TD}>
                      <form action={cambiarRolUsuario} className="flex items-center gap-2">
                        <input type="hidden" name="user_id" value={p.id} />
                        <select
                          name="rol"
                          defaultValue={p.rol}
                          disabled={esYo}
                          aria-label={`Rol de ${p.nombre}`}
                          className="rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none disabled:bg-stone-100"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ETIQUETAS_ROL[r]}
                            </option>
                          ))}
                        </select>
                        {!esYo && (
                          <button className={botonClases('secundario', 'px-2 py-1 text-xs')}>
                            Guardar
                          </button>
                        )}
                      </form>
                    </td>
                    <td className={TD}>
                      {esYo ? (
                        <Etiqueta tono="exito">Activo</Etiqueta>
                      ) : (
                        <form action={alternarActivoUsuario}>
                          <input type="hidden" name="user_id" value={p.id} />
                          <input type="hidden" name="activo" value={String(p.activo)} />
                          <button
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition ${
                              p.activo
                                ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100'
                                : 'bg-stone-100 text-stone-600 ring-stone-200 hover:bg-stone-200'
                            }`}
                            aria-label={`${p.activo ? 'Desactivar' : 'Activar'} a ${p.nombre}`}
                          >
                            {p.activo ? 'Activo' : 'Inactivo'}
                          </button>
                        </form>
                      )}
                    </td>
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
