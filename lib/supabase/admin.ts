import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { envServidor } from '@/lib/env'

/**
 * Cliente privilegiado de Supabase (service role). SOLO debe usarse en código
 * de servidor para operaciones que necesitan saltarse RLS de forma controlada
 * (por ejemplo, webhooks de pago que confirman una reserva).
 *
 * NUNCA se debe importar desde un Client Component: la `service_role` key da
 * acceso total a la base de datos. El import de `server-only` hace fallar el
 * build si alguien lo intenta.
 */
export function crearClienteAdmin() {
  // Se validan acá y no con `!`: si falta la clave, el error dice cuál falta
  // en vez de fallar más adelante como un problema de red.
  const env = envServidor()
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}
