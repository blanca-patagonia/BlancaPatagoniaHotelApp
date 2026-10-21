import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchConCorte } from './fetch-con-corte'
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
/**
 * Un cliente con `service_role`, MARCADO en el tipo.
 *
 * Hay escrituras que sólo puede hacer el sistema —la bandeja de avisos
 * (`notificaciones`), igual que `errores` y `auditoria`— y la base las niega al
 * cliente del usuario. Pasarle a esas funciones el cliente de la sesión no daba
 * error de compilación: fallaba en tiempo de ejecución con «permission denied»,
 * y como `encolar` no corta, el aviso simplemente no salía. Así estuvieron el
 * correo de cancelación, los avisos de cobro, el «habitación lista» de
 * housekeeping y el mensaje al huésped del asistente (2026-10-20).
 *
 * Con la marca, una función que exige `ClienteServicio` no acepta el cliente del
 * usuario: el error aparece al compilar. Sigue siendo un `SupabaseClient` para
 * todo lo demás.
 */
export type ClienteServicio = SupabaseClient & { readonly __servicio: true }

export function crearClienteAdmin(): ClienteServicio {
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
      // 20 s y no 10: este cliente lo usan los crons, las exportaciones y la
      // subida de adjuntos, que pueden tardar más que una consulta de página.
      // Sin corte, una base colgada retenía la función hasta su límite.
      global: { fetch: fetchConCorte(20_000) },
    },
  ) as ClienteServicio
}
