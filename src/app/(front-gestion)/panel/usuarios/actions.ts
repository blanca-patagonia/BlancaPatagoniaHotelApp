'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { requerirRol } from '@/lib/auth/session'
import { esRolValido } from '@/lib/domain/roles'
import { LARGO_MINIMO_PASSWORD } from '@/lib/domain/cuenta'
import { cortarSiFalla, mensajeDeFalla } from '@/lib/acciones'
import { falloConValores, type ValoresFormulario } from '@/lib/domain/formularios'

export interface EstadoUsuario {
  error?: string
  ok?: string
  /** Lo escrito, para reponerlo si la acción falla (React resetea el form). */
  valores?: ValoresFormulario
}

// Más estrecho que el área `usuarios` a propósito: dar de alta, cambiar roles y
// dar de baja es sólo del administrador (ver `requerirRol`).
function exigirAdmin() {
  return requerirRol('admin')
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

  if (!email || !password || !nombre) return falloConValores('Completá nombre, email y contraseña.', formData)
  if (password.length < LARGO_MINIMO_PASSWORD) {
    return falloConValores(`La contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`, formData)
  }
  if (!esRolValido(rol)) return falloConValores('Elegí un rol válido.', formData)

  const admin = crearClienteAdmin()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre },
  })
  if (error || !data.user) {
    // Auth responde en inglés («A user with this email address has already
    // been registered»): se traduce el caso que tiene arreglo y el resto va al log.
    const yaExiste = /already (been )?registered|already exists/i.test(error?.message ?? '')
    if (yaExiste) return falloConValores('Ya hay un usuario con ese email.', formData)
    return falloConValores(mensajeDeFalla(error ?? { message: 'sin usuario' }, 'usuarios:crear', 'No se pudo crear el usuario'), formData)
  }

  const { error: eRol } = await admin
    .from('perfiles')
    .update({ rol, nombre, activo: true })
    .eq('id', data.user.id)
  if (eRol) {
    // El usuario YA existe: no se repone lo escrito, para que nadie lo reenvíe.
    return { error: mensajeDeFalla(eRol, 'usuarios:asignar_rol', 'El usuario se creó, pero no se pudo asignar el rol: asignáselo desde la lista') }
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
  const sesion = await exigirAdmin()
  const id = String(formData.get('user_id') ?? '')
  const rol = String(formData.get('rol') ?? '')
  // Un admin no se cambia el rol a sí mismo: un POST directo podía dejar el
  // sistema sin administrador (la pantalla sólo deshabilitaba el control).
  if (id === sesion.userId) redirect('/panel/usuarios?error=propio')
  if (id && esRolValido(rol)) {
    const { error } = await crearClienteAdmin().from('perfiles').update({ rol }).eq('id', id)
    cortarSiFalla(error, '/panel/usuarios', 'rol')
  }
  redirect('/panel/usuarios')
}

export async function alternarActivoUsuario(formData: FormData): Promise<void> {
  const sesion = await exigirAdmin()
  const id = String(formData.get('user_id') ?? '')
  /*
    El estado DESTINO, explícito. Antes se invertía el `activo` que traía el
    formulario: con la pantalla vieja abierta, «Desactivar» podía reactivar a
    alguien que otro admin ya había dado de baja.
  */
  const destino = String(formData.get('estado_destino') ?? '')
  if (destino !== 'activo' && destino !== 'inactivo') redirect('/panel/usuarios?error=activo')
  if (id === sesion.userId) redirect('/panel/usuarios?error=propio')
  if (id) {
    const { error } = await crearClienteAdmin()
      .from('perfiles')
      .update({ activo: destino === 'activo' })
      .eq('id', id)
    cortarSiFalla(error, '/panel/usuarios', 'activo')
  }
  redirect('/panel/usuarios')
}
