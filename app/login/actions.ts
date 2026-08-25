'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { permitirIntento } from '@/lib/limites'
import { mensajeLimite } from '@/lib/domain/limites'
import { LARGO_MINIMO_PASSWORD } from '@/lib/domain/cuenta'
import { envPublico, urlDelSitio } from '@/lib/env'

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

/**
 * ¿Está configurado el inicio de sesión con Google?
 *
 * ── Se le pregunta a GoTrue, no se adivina ──────────────────────────────────
 *
 * Esto antes leía `AUTH_GOOGLE_HABILITADO`, una variable de **la app Next**. El
 * problema es que quien atiende el intercambio OAuth no es la app: es **GoTrue**,
 * otro servicio, con su propia configuración (`[auth.external.google]` en
 * `supabase/config.toml`, o el panel de Supabase en la nube).
 *
 * Eran dos interruptores independientes que tenían que coincidir, y nada
 * verificaba que coincidieran. Con la variable en `1` y el proveedor apagado, el
 * botón aparecía, redirigía a GoTrue y GoTrue contestaba un JSON crudo:
 * `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider:
 * provider is not enabled"}`. Sin vuelta atrás y sin explicación — exactamente el
 * botón que existe y falla que el ADR 0018 dice que no hay que tener.
 *
 * `/auth/v1/settings` es un endpoint público de GoTrue que informa qué
 * proveedores tiene realmente habilitados. Preguntándole, la pantalla no puede
 * volver a ofrecer algo que no funciona: se acabó la clase entera de error, en
 * vez de documentarla.
 *
 * Dos decisiones acompañan:
 *
 * - **Falla cerrado.** Si la consulta no responde, se devuelve `false`. Un botón
 *   que falta se nota y se pregunta; uno que rompe deja a alguien trabado en una
 *   pantalla de JSON.
 * - **`AUTH_GOOGLE_HABILITADO=0` sigue sirviendo, pero solo para APAGAR.** Deja al
 *   hotel esconder el botón aunque el proveedor esté configurado. Encenderlo ya no
 *   depende de esa variable, que es lo que causaba el problema.
 */
export async function googleHabilitado(): Promise<boolean> {
  // Interruptor de apagado explícito: gana sobre lo que diga GoTrue.
  if (process.env.AUTH_GOOGLE_HABILITADO === '0') return false

  try {
    const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: clave } = envPublico()
    const respuesta = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: clave },
      // La respuesta solo cambia cuando se reinicia el contenedor o se toca la
      // configuración del proyecto. Media hora de caché evita una llamada de red
      // en cada render del login sin quedarse pegado a un valor viejo.
      next: { revalidate: 1800 },
    })
    if (!respuesta.ok) return false
    const ajustes = (await respuesta.json()) as { external?: Record<string, boolean> }
    return ajustes.external?.google === true
  } catch {
    return false
  }
}

/**
 * Inicia el intercambio con Google.
 *
 * Devuelve una redirección del navegador a la pantalla de Google; la vuelta la
 * atiende `app/auth/callback/route.ts`, que es donde se canjea el código y —más
 * importante— donde se verifica que la persona además tenga acceso al panel.
 *
 * ── Por qué esto NO abre la puerta a cualquiera ─────────────────────────────
 *
 * `[auth].enable_signup = false` (supabase/config.toml) impide que GoTrue **cree**
 * un usuario nuevo por cualquier proveedor, Google incluido. Así que iniciar
 * sesión con Google solo funciona para alguien cuyo email **ya existe** porque un
 * administrador lo dio de alta desde `app/panel/usuarios`. El ADR 0005 y el 0017
 * siguen valiendo tal cual.
 *
 * Y si esa configuración se aflojara, la segunda barrera sigue en pie: un perfil
 * creado fuera del alta nace `sin_rol` y `activo = false` (migraciones 0032 y
 * 0035), así que no vería nada.
 */
export async function iniciarSesionConGoogle(): Promise<void> {
  if (!(await googleHabilitado())) {
    redirect('/login?error=google_no_configurado')
  }

  // El límite es el mismo del login con contraseña: un botón que dispara un
  // intercambio OAuth también se puede usar para hacer ruido.
  if (!(await permitirIntento('login'))) {
    redirect('/login?error=demasiados_intentos')
  }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${urlDelSitio()}/auth/callback`,
      // `prompt: 'select_account'` para que en un puesto compartido de recepción
      // Google no entre solo con la última cuenta usada.
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error || !data?.url) {
    console.error('[login] no se pudo iniciar el intercambio con Google:', error?.message)
    redirect('/login?error=google')
  }

  redirect(data.url)
}
