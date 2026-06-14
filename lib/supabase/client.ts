import { createBrowserClient } from '@supabase/ssr'

/**
 * Cliente de Supabase para usar en el navegador (Client Components).
 * Comparte la sesión con el servidor a través de las cookies.
 */
export function crearClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
