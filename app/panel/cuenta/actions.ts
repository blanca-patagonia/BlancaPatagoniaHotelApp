'use server'

import { requerirSesion } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  LARGO_MINIMO_PASSWORD,
  validarCambioPassword,
  validarMisDatos,
} from '@/lib/domain/cuenta'

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

/**
 * Guarda los datos propios: nombre y teléfono.
 *
 * ── Por qué no se puede usar para ascenderse ────────────────────────────────
 *
 * No alcanza con que esta función mande solo dos campos: quien quiera hacer
 * trampa no la usa, arma la petición a mano contra PostgREST con la clave
 * publicable, que viaja al navegador por diseño.
 *
 * La defensa está en la base (migración 0066): `authenticated` tiene el UPDATE
 * de `perfiles` acotado **por columna** a `nombre` y `telefono`, así que Postgres
 * rechaza cualquier intento de tocar `rol` o `activo` con el cliente del usuario.
 * Esto de acá es la comodidad; aquello es la garantía.
 *
 * Se apunta a `sesion.userId` y no a un identificador del formulario: el `id` sale
 * del token, no de lo que mande el navegador. La política RLS lo vuelve a exigir
 * (`id = auth.uid()`), pero el código no debería depender de eso para no
 * mandarle a la base una consulta que espera que rechace.
 */
export async function guardarMisDatos(
  _prev: EstadoCuenta,
  formData: FormData,
): Promise<EstadoCuenta> {
  const sesion = await requerirSesion()

  const nombre = String(formData.get('nombre') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim()

  const motivo = validarMisDatos(nombre, telefono)
  if (motivo) return { error: motivo }

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('perfiles')
    .update({ nombre, telefono })
    .eq('id', sesion.userId)

  if (error) {
    // El detalle va al log, nunca a la pantalla.
    console.error('[cuenta] no se pudieron guardar los datos:', error.message)
    return { error: 'No se pudieron guardar tus datos. Quedaron como estaban.' }
  }

  // El nombre se ve en el encabezado y en el menú de cuenta, que los pinta el
  // layout: sin revalidar, se sigue mostrando el anterior hasta recargar a mano.
  revalidatePath('/panel', 'layout')
  return { ok: 'Listo, tus datos quedaron guardados.' }
}
