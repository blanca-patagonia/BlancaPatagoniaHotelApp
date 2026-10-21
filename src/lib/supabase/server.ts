import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fetchConCorte } from './fetch-con-corte'

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
      // 10 s por consulta: una página no espera a una base colgada hasta el
      // límite de la función (ver `fetchConCorte`).
      global: { fetch: fetchConCorte(10_000) },
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
