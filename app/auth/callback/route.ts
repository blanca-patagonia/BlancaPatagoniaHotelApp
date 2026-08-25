import { NextResponse } from 'next/server'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { registrarError } from '@/lib/registro'

/**
 * Vuelta del proveedor externo (Google): `GET /auth/callback`.
 *
 * Supabase manda acá con un `code` de un solo uso que hay que canjear por la
 * sesión. El canje escribe las cookies, así que tiene que pasar por
 * `crearClienteServidor()` y no por el cliente del navegador.
 *
 * ── La parte que importa, y que no es el canje ──────────────────────────────
 *
 * Que alguien se autentique con Google **no le da acceso al panel**. El ADR 0005
 * y el 0017 fijan que el staff no se auto-registra: los usuarios los crea un
 * administrador, y un alta que no pase por ahí nace `sin_rol` y `activo = false`
 * (migraciones 0032 y 0035).
 *
 * Con `[auth].enable_signup = false` GoTrue directamente **no crea** el usuario si
 * el email no existe, así que un desconocido no llega ni a tener cuenta. Pero hay
 * un caso intermedio que sí ocurre y hay que atender: un usuario que existe en
 * `auth.users` pero cuyo perfil todavía no tiene rol —recién dado de alta, o dado
 * de baja—. Ése se autentica bien y `obtenerSesion()` le devuelve `null`.
 *
 * Sin este control terminaría rebotando entre `/panel` y `/login` sin entender
 * por qué: la pantalla lo mandaría al login, el login lo mandaría al panel al ver
 * que hay sesión de Supabase, y así. Se le cierra la sesión y se le explica.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const errorProveedor = url.searchParams.get('error')

  // El usuario canceló en la pantalla de Google, o el proveedor rechazó.
  if (errorProveedor) {
    return NextResponse.redirect(new URL('/login?error=google_cancelado', url.origin))
  }
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=google_sin_codigo', url.origin))
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // El detalle va al log, no a la URL: a quien intenta entrar no le sirve el
    // mensaje de GoTrue, y a quien tiene que diagnosticar sí.
    await registrarError('google_canje_fallido', { detalle: error.message })
    return NextResponse.redirect(new URL('/login?error=google', url.origin))
  }

  /*
    Autenticado ≠ autorizado. `obtenerSesion()` devuelve `null` si el perfil no
    tiene rol válido o está dado de baja, que es justo lo que hay que detectar.
  */
  const sesion = await obtenerSesion()
  if (!sesion) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=google_sin_acceso', url.origin))
  }

  return NextResponse.redirect(new URL('/panel', url.origin))
}
