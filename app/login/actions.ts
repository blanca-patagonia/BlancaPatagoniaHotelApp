'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { permitirIntento } from '@/lib/limites'
import { mensajeLimite } from '@/lib/domain/limites'

export interface EstadoLogin {
  error?: string
}

export async function iniciarSesion(
  _prev: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { error: 'Ingresá tu email y contraseña.' }
  }

  /*
    Freno a la fuerza bruta. Supabase Auth ya limita del lado del servidor, pero
    este control agrega dos cosas: corta antes de llegar, y deja registro local
    del intento (`intentos_limitados`), que es lo que permite notar un ataque.

    Se comprueba antes de consultar las credenciales para no darle a un atacante
    una vía de medir si el email existe por la diferencia de tiempo.
  */
  if (!(await permitirIntento('login'))) {
    return { error: mensajeLimite('login') }
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Mensaje único a propósito: distinguir «no existe» de «contraseña
    // incorrecta» le confirmaría a un atacante qué cuentas existen.
    return { error: 'Email o contraseña incorrectos.' }
  }

  redirect('/panel')
}

export async function cerrarSesion(): Promise<void> {
  const supabase = await crearClienteServidor()
  await supabase.auth.signOut()
  redirect('/login')
}
