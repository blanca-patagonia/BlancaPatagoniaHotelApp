import 'server-only'
import { createClient } from '@supabase/supabase-js'

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
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}
