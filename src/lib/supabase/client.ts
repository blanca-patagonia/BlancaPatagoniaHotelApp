import { createBrowserClient } from '@supabase/ssr'

/**
 * Cliente de Supabase para usar en el navegador (Client Components).
 * Comparte la sesión con el servidor a través de las cookies.
 *
 * Lee las dos variables directamente y no por `envPublico()` de `lib/env.ts`:
 * ésa valida con zod, y por este archivo zod entraba entero al JavaScript que
 * descarga el navegador (estaba 485 veces en el chunk de conversaciones, de
 * 516 KB). Next reemplaza `process.env.NEXT_PUBLIC_*` por su valor al compilar,
 * así que el acceso tiene que ser literal, propiedad por propiedad.
 */
export function crearClienteNavegador() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !clave) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY (ver COMO-LEVANTARLO.md).',
    )
  }
  return createBrowserClient(url, clave)
}
