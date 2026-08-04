import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Acceso compartido a la base para los tests de integración.
 *
 * Los tests que tocan Postgres se **saltean** cuando no hay credenciales, para
 * que `npm test` siga siendo útil sin levantar Docker. El problema de saltear
 * en silencio es que en CI el badge queda verde **sin haber probado nada**:
 * justamente el anti-overbooking, que es la garantía central del sistema
 * (ADR 0002), es de los que se saltean.
 *
 * Por eso existe `EXIGIR_DB`: cuando vale `1` —como en el workflow de CI— la
 * falta de base es un **error**, no un salto. Si Supabase no levantó, la suite
 * falla y se ve.
 */

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const hayDB = Boolean(url && serviceKey && !url.includes('placeholder'))

if (process.env.EXIGIR_DB === '1' && !hayDB) {
  throw new Error(
    'EXIGIR_DB=1 pero faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. ' +
      'Los tests de integración se habrían salteado dejando el CI en verde sin ' +
      'verificar el anti-overbooking. Revisá que `supabase start` haya funcionado.',
  )
}

/** Cliente con `service_role` para preparar y limpiar datos de prueba. */
export function clienteDePrueba(): SupabaseClient {
  return createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Sufijo aleatorio para que dos corridas no colisionen entre sí. */
export function sufijoUnico(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** Arma el literal de `daterange` que espera Postgres. */
export function periodo(desde: string, hasta: string): string {
  return `[${desde},${hasta})`
}
