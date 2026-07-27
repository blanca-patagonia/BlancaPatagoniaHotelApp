'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'

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

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'Email o contraseña incorrectos.' }
  }

  redirect('/panel')
}

export async function cerrarSesion(): Promise<void> {
  const supabase = await crearClienteServidor()
  await supabase.auth.signOut()
  redirect('/login')
}
