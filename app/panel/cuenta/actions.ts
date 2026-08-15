'use server'

import { requerirSesion } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { LARGO_MINIMO_PASSWORD, validarCambioPassword } from '@/lib/domain/cuenta'

export interface EstadoCuenta {
  error?: string
  ok?: string
}

/**
 * Cambio de la propia contraseña.
 *
 * Por qué no lleva `requerirAcceso(area)`: no hay área que valga. Esta acción no
 * opera sobre datos del hotel sino sobre la cuenta de quien la invoca, y la
 * tiene que poder usar **cualquiera** que esté adentro, housekeeping incluido.
 * Lo que sí exige es sesión: `requerirSesion` corre primero y `updateUser`
 * trabaja sobre el usuario del token, así que no hay forma de apuntarle a otro.
 *
 * ⚠️ Se verifica la contraseña actual antes de cambiarla, con un
 * `signInWithPassword` contra el propio email. Sin eso, una sesión olvidada
 * abierta en la computadora del mostrador alcanza para que un tercero se quede
 * con la cuenta: cambia la clave y el dueño queda afuera. La verificación es lo
 * que convierte «tener la pantalla abierta» en «saber la contraseña».
 */
export async function cambiarMiPassword(
  _prev: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  const sesion = await requerirSesion()

  const actual = String(formData.get('actual') ?? '')
  const nueva = String(formData.get('nueva') ?? '')
  const repetida = String(formData.get('repetida') ?? '')

  const problema = validarCambioPassword({ actual, nueva, repetida })
  if (problema) return { error: problema }

  const supabase = await crearClienteServidor()

  const { error: eActual } = await supabase.auth.signInWithPassword({
    email: sesion.email,
    password: actual,
  })
  if (eActual) return { error: 'La contraseña actual no es correcta.' }

  const { error } = await supabase.auth.updateUser({ password: nueva })
  if (error) {
    // El detalle técnico va al log, no a la pantalla.
    console.error('No se pudo cambiar la contraseña:', error.message)
    return {
      error: `No se pudo cambiar la contraseña. Probá con otra de al menos ${LARGO_MINIMO_PASSWORD} caracteres.`,
    }
  }

  return { ok: 'Listo, tu contraseña quedó cambiada. La próxima vez entrá con la nueva.' }
}
