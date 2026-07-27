import 'server-only'
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

export async function obtenerSesion(): Promise<Sesion | null> {
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
}

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
