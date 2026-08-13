'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerSesion } from '@/lib/auth/session'
import { esRolValido } from '@/lib/domain/roles'
import { cortarSiFalla } from '@/lib/acciones'

export interface EstadoUsuario {
  error?: string
  ok?: string
}

async function exigirAdmin() {
  const sesion = await obtenerSesion()
  if (!sesion || sesion.rol !== 'admin') redirect('/panel')
}

export async function crearUsuario(
  _prev: EstadoUsuario,
  formData: FormData,
): Promise<EstadoUsuario> {
  await exigirAdmin()

  const email = String(formData.get('email') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const rol = String(formData.get('rol') ?? '')
  const password = String(formData.get('password') ?? '')

  if (!email || !password || !nombre) return { error: 'Completá nombre, email y contraseña.' }
  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' }
  if (!esRolValido(rol)) return { error: 'Elegí un rol válido.' }

  const admin = crearClienteAdmin()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre },
  })
  if (error || !data.user) {
    return { error: `No se pudo crear el usuario: ${error?.message ?? 'desconocido'}` }
  }

  const { error: eRol } = await admin
    .from('perfiles')
    .update({ rol, nombre, activo: true })
    .eq('id', data.user.id)
  if (eRol) {
    return { error: `Usuario creado, pero no se pudo asignar el rol: ${eRol.message}` }
  }

  revalidatePath('/panel/usuarios')
  return { ok: `Usuario ${email} creado con rol ${rol}.` }
}

/**
 * Estas dos acciones escriben con el cliente **admin**, que saltea RLS. Eso
 * cambia qué significa un error: no puede ser un rechazo de permisos, así que si
 * falla es una falla real. Y el fallo silencioso es más grave que en el resto del
 * panel —un administrador queda convencido de que cambió el rol de alguien, o de
 * que lo dio de baja, y no pasó nada—, que es una diferencia de seguridad y no de
 * comodidad.
 */
export async function cambiarRolUsuario(formData: FormData): Promise<void> {
  await exigirAdmin()
  const id = String(formData.get('user_id') ?? '')
  const rol = String(formData.get('rol') ?? '')
  if (id && esRolValido(rol)) {
    const { error } = await crearClienteAdmin().from('perfiles').update({ rol }).eq('id', id)
    cortarSiFalla(error, '/panel/usuarios', 'rol')
  }
  redirect('/panel/usuarios')
}

export async function alternarActivoUsuario(formData: FormData): Promise<void> {
  await exigirAdmin()
  const id = String(formData.get('user_id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  if (id) {
    const { error } = await crearClienteAdmin()
      .from('perfiles')
      .update({ activo: !activo })
      .eq('id', id)
    cortarSiFalla(error, '/panel/usuarios', 'activo')
  }
  redirect('/panel/usuarios')
}
