import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Cliente de Supabase para usar en el servidor (Server Components, Route
 * Handlers y Server Actions). Lee y escribe la sesión desde las cookies.
 *
 * En Next.js 16 `cookies()` es asíncrono, por eso la función es `async`.
 */
export async function crearClienteServidor() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Invocado desde un Server Component: el refresco de la sesión
            // lo realiza `proxy.ts`, así que aquí se puede ignorar.
          }
        },
      },
    },
  )
}
