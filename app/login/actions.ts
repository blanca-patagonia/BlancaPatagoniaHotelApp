'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { permitirIntento } from '@/lib/limites'
import { mensajeLimite } from '@/lib/domain/limites'
import { LARGO_MINIMO_PASSWORD } from '@/lib/domain/cuenta'
import { urlDelSitio } from '@/lib/env'

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

export interface EstadoRecuperar {
  error?: string
  ok?: string
}

/**
 * Envía el enlace para volver a entrar cuando alguien perdió su contraseña.
 *
 * ── Por qué la respuesta es siempre la misma ────────────────────────────────
 *
 * Exista o no el email, se responde el mismo texto. Es deliberado y es la única
 * parte de este flujo que hay que cuidar: si dijera «no hay ninguna cuenta con
 * ese email», el formulario se convierte en un verificador de cuentas del staff
 * que cualquiera puede consultar desde internet. Con la lista de correos, el
 * siguiente paso obvio es la fuerza bruta contra el login.
 *
 * Por el mismo motivo `resetPasswordForEmail` **no se comprueba**: su error
 * distinguiría los dos casos, así que se ignora a propósito y solo va al log.
 *
 * ── Por qué hacía falta ─────────────────────────────────────────────────────
 *
 * Hasta acá no había forma de recuperar una contraseña: quien la perdía dependía
 * de que un administrador estuviera disponible. Con un solo usuario admin —que
 * es la situación actual— eso significa que si esa persona pierde su clave,
 * nadie entra al sistema. Para un hotel que trabaja de noche y fines de semana
 * es un riesgo operativo, no teórico.
 */
export async function pedirRecuperacion(
  _prev: EstadoRecuperar,
  formData: FormData,
): Promise<EstadoRecuperar> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) return { error: 'Ingresá tu email.' }

  // Antes de tocar nada: el límite protege contra la enumeración por tiempos y
  // contra usar esto como ametralladora de correos.
  if (!(await permitirIntento('recuperar_password'))) {
    return { error: mensajeLimite('recuperar_password') }
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${urlDelSitio()}/login/nueva-contrasena`,
  })

  // El detalle va al log del servidor, nunca a la pantalla: ver arriba.
  if (error) console.error('[recuperación] no se pudo enviar el enlace:', error.message)

  return {
    ok: 'Si ese email corresponde a una cuenta del sistema, te llegó un enlace para volver a entrar. Revisá tu casilla.',
  }
}

export interface EstadoNuevaPassword {
  error?: string
}

/**
 * Fija la contraseña nueva después de entrar por el enlace del correo.
 *
 * No pide la contraseña actual —quien llega acá justamente no la tiene—, pero
 * tampoco es un camino abierto: `updateUser` opera sobre la sesión que creó el
 * enlace de recuperación, y sin ese enlace no hay sesión que actualizar. El
 * chequeo de que exista sesión es lo que lo cierra.
 *
 * La validación de la contraseña es la misma que la del cambio desde adentro
 * (`lib/domain/cuenta.ts`), menos la comparación con la actual, que acá no se
 * conoce.
 */
export async function fijarNuevaPassword(
  _prev: EstadoNuevaPassword,
  formData: FormData,
): Promise<EstadoNuevaPassword> {
  const nueva = String(formData.get('nueva') ?? '')
  const repetida = String(formData.get('repetida') ?? '')

  if (!nueva) return { error: 'Escribí la contraseña nueva.' }
  if (nueva.length < LARGO_MINIMO_PASSWORD) {
    return { error: `La contraseña tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.` }
  }
  if (nueva !== repetida) return { error: 'Las dos contraseñas no coinciden.' }

  const supabase = await crearClienteServidor()

  // Sin la sesión del enlace no hay nada que actualizar. Se comprueba explícito
  // para poder explicar qué pasó: el enlace caduca, y sin este mensaje el
  // usuario vería un error genérico y no sabría que tiene que pedir otro.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      error:
        'El enlace no es válido o ya venció. Pedí uno nuevo desde «¿Olvidaste tu contraseña?».',
    }
  }

  const { error } = await supabase.auth.updateUser({ password: nueva })
  if (error) {
    console.error('[recuperación] no se pudo fijar la contraseña:', error.message)
    return { error: 'No se pudo cambiar la contraseña. Probá con otra.' }
  }

  redirect('/panel')
}
