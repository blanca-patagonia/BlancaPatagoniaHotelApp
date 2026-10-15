import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refresca la sesión de Supabase en cada request. Se invoca desde `proxy.ts`
 * (la convención que reemplaza a `middleware.ts` en Next.js 16).
 *
 * Patrón oficial de @supabase/ssr: NO debe insertarse lógica entre la creación
 * del cliente y `getUser()`, para no introducir bugs difíciles de depurar en el
 * refresco del token.
 */
export async function actualizarSesion(
  request: NextRequest,
  /**
   * Cabeceras extra que hay que **reenviar a la aplicación**, no devolver al
   * navegador.
   *
   * Existe por el idioma: `app/layout.tsx` escribe el `lang` del `<html>` y
   * está por encima del segmento `[idioma]`, así que no puede leerlo de
   * `params`. `headers()` lee las cabeceras de la **petición**, no las de la
   * respuesta, y la única forma de agregarle una desde el proxy es reconstruir
   * la petición con `NextResponse.next({ request: { headers } })`. Setearla en
   * la respuesta —el primer intento— no se ve desde el servidor.
   */
  extra?: Record<string, string>,
) {
  /*
    Se clonan porque las cabeceras de un `NextRequest` son de sólo lectura.
  */
  const cabeceras = new Headers(request.headers)
  for (const [clave, valor] of Object.entries(extra ?? {})) {
    cabeceras.set(clave, valor)
  }

  let response = NextResponse.next({ request: { headers: cabeceras } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request: { headers: cabeceras } })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // Refresca el token si está vencido. No agregar código antes de esta línea.
  await supabase.auth.getUser()

  return response
}
