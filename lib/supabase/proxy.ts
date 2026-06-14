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
export async function actualizarSesion(request: NextRequest) {
  let response = NextResponse.next({ request })

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
          response = NextResponse.next({ request })
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
