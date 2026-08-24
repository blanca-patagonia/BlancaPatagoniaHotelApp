import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { esRolValido, type Rol } from '@/lib/domain/roles'
import { puedeAcceder, type Area } from '@/lib/domain/permisos'

/**
 * Resolución de la sesión del staff en el servidor. Combina el usuario de
 * Supabase Auth con su `perfil` (rol) y ofrece guards para las páginas del panel.
 */

export interface Sesion {
  userId: string
  email: string
  nombre: string
  rol: Rol
}

/**
 * Resuelve la sesión una sola vez por petición.
 *
 * ── Por qué el `cache()` ────────────────────────────────────────────────────
 *
 * Cada carga de una pantalla del panel pasa por tres capas que preguntan quién
 * es el usuario: el `proxy.ts` refresca el token, `app/panel/layout.tsx` llama a
 * `requerirSesion()` y la página llama a `requerirAcceso(area)`. Sin memoizar,
 * eso son **tres llamadas a Auth y dos SELECT sobre `perfiles`**, en serie, antes
 * de empezar el trabajo real. Es latencia fija en cada navegación, y crece sola
 * si mañana se agrega otra capa de layout.
 *
 * `cache()` de React deduplica por petición: la primera llamada consulta y las
 * siguientes reciben el mismo resultado. No es un caché entre peticiones —cada
 * request vuelve a resolver—, así que una baja de usuario sigue teniendo efecto
 * inmediato, que es lo que la migración 0033 vino a garantizar.
 *
 * `requerirSesion` y `requerirAcceso` se benefician sin cambios: las dos pasan
 * por acá.
 */
export const obtenerSesion = cache(async (): Promise<Sesion | null> => {
  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('nombre, rol, activo')
    .eq('id', user.id)
    .single()

  if (!perfil || !perfil.activo || !esRolValido(perfil.rol)) return null

  return {
    userId: user.id,
    email: user.email ?? '',
    nombre: perfil.nombre || (user.email ?? ''),
    rol: perfil.rol,
  }
})

/** Exige sesión activa; si no la hay, redirige al login. */
export async function requerirSesion(): Promise<Sesion> {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/login')
  return sesion
}

/** Exige sesión con permiso sobre `area`; si no, redirige al inicio del panel. */
export async function requerirAcceso(area: Area): Promise<Sesion> {
  const sesion = await requerirSesion()
  if (!puedeAcceder(sesion.rol, area)) redirect('/panel')
  return sesion
}
