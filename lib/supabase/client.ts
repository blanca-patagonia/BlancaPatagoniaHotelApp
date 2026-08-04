import { createBrowserClient } from '@supabase/ssr'
import { envPublico } from '@/lib/env'

/**
 * Cliente de Supabase para usar en el navegador (Client Components).
 * Comparte la sesión con el servidor a través de las cookies.
 */
export function crearClienteNavegador() {
  const env = envPublico()
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
