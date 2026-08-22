import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { clienteDePrueba, hayAnon, sufijoUnico } from './db'

/**
 * Las dos garantías de autenticación que tienen que sostenerse **a la vez**.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────────
 *
 * `supabase/config.toml` tenía `[auth.email].enable_signup = false`, puesto con la
 * intención de cerrar el auto-registro (ADR 0017). Pero esa opción **no controla el
 * alta**: controla si el proveedor de email está habilitado, y en `false` desactiva
 * **también el inicio de sesión con contraseña** — que es el único camino de acceso
 * del staff (`app/login/actions.ts`).
 *
 * O sea: en un entorno levantado desde cero, **nadie podía entrar al panel**.
 *
 * No se notó por una razón que vale registrar: un contenedor que ya está corriendo
 * conserva la configuración con la que arrancó. Localmente todo funcionaba porque el
 * entorno era anterior al cambio. Lo detectó el CI, que hace `supabase start` limpio
 * en cada corrida y falló con «Email logins are disabled».
 *
 * Peor todavía: ese mismo contenedor viejo tenía `DISABLE_SIGNUP=false`, así que el
 * registro **estaba abierto** en local — exactamente lo que el ADR 0017 cierra.
 *
 * ── Por qué las dos juntas y no una ─────────────────────────────────────────
 *
 * Son opuestas y fáciles de romper de a una. Arreglar el login reabriendo el registro
 * deshace la decisión de seguridad; cerrar el registro con la opción equivocada deja
 * al hotel sin poder entrar. Un test de cada lado obliga a mantener las dos.
 */

const sufijo = sufijoUnico()

/**
 * Contraseña de un solo uso, generada acá.
 *
 * No va como literal en el archivo: aunque sea de un usuario de prueba que se borra al
 * terminar, una cadena con pinta de contraseña en el repositorio queda en el historial
 * de git para siempre y entrena a que la próxima pase sin que nadie la mire.
 */
function contrasenaDeUnUso(): string {
  return randomBytes(18).toString('base64url')
}

/** Cliente anónimo con la clave publicable: lo mismo que tiene un navegador. */
function anonimo() {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

describe.skipIf(!hayAnon)('configuración de autenticación', () => {
  it('el staff SÍ puede iniciar sesión con email y contraseña', async () => {
    /*
      Es el único camino de acceso al panel. Si esto falla, el sistema entero es
      inaccesible aunque todo lo demás funcione.

      Se crea el usuario con `service_role` —el mismo camino que usa el alta desde
      `app/panel/usuarios`— y se inicia sesión como lo haría el navegador.
    */
    const admin = clienteDePrueba()
    const email = `login-${sufijo}@example.com`
    const clave = contrasenaDeUnUso()

    const { data: creado, error: eAlta } = await admin.auth.admin.createUser({
      email,
      password: clave,
      email_confirm: true,
    })
    if (eAlta || !creado.user) throw new Error(`No se pudo crear el usuario: ${eAlta?.message}`)

    try {
      const { data, error } = await anonimo().auth.signInWithPassword({ email, password: clave })

      expect(
        error,
        'el login por contraseña está desactivado: nadie puede entrar al panel',
      ).toBeNull()
      expect(data.session).not.toBeNull()
    } finally {
      await admin.auth.admin.deleteUser(creado.user.id).catch(() => {})
    }
  })

  it('NADIE se auto-registra desde el borde público', async () => {
    /*
      La decisión del ADR 0017. La clave publicable viaja al navegador por diseño, así
      que con el registro abierto cualquiera se crea una cuenta — y hasta la migración
      0032 esa cuenta nacía con rol de recepción activo.

      Se verifica de las dos formas posibles, porque GoTrue puede responder distinto
      según la versión: o rechaza con error, o «acepta» sin crear sesión ni usuario.
    */
    const email = `intruso-${sufijo}@example.com`
    const { data, error } = await anonimo().auth.signUp({
      email,
      password: contrasenaDeUnUso(),
    })

    const seRegistro = !error && Boolean(data.user?.id) && Boolean(data.session)
    expect(seRegistro, 'el auto-registro está ABIERTO: cualquiera se crea una cuenta').toBe(false)

    // Y por las dudas: que no haya quedado un perfil creado aunque no haya sesión.
    if (data.user?.id) {
      const admin = clienteDePrueba()
      const { data: existe } = await admin
        .from('perfiles')
        .select('id')
        .eq('id', data.user.id)
        .maybeSingle()
      expect(existe, 'quedó un perfil creado desde el borde público').toBeNull()
      await admin.auth.admin.deleteUser(data.user.id).catch(() => {})
    }
  })
})
