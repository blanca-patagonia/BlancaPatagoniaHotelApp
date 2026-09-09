import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'

export type OrigenAccesoHuesped = 'ficha_huesped' | 'ficha_reserva'

/**
 * Deja constancia de que el rol actual abrió la ficha de un huésped.
 *
 * Patrón de referencia: la auditoría de acceso a PII de Hotel PMS. Se hace por
 * RPC (`registrar_acceso_huesped`, migración 0091) y no por un `insert` directo
 * porque un SELECT no dispara triggers en Postgres — a diferencia de
 * `auditoria` (migración 0020), que sí puede colgarse de un trigger porque
 * audita escrituras. El usuario y el rol los toma la función del lado del
 * servidor (`auth.uid()`/`rol_actual()`), nunca un parámetro que esta llamada
 * podría mentir.
 *
 * Es una escritura ACCESORIA: si falla, no tiene sentido romper la ficha que
 * el usuario vino a ver por un problema de registro. Se loguea con
 * `registrarFalla` y se sigue.
 */
export async function registrarAccesoHuesped(
  supabase: SupabaseClient,
  huespedId: string,
  origen: OrigenAccesoHuesped,
): Promise<void> {
  const { error } = await supabase.rpc('registrar_acceso_huesped', {
    p_huesped_id: huespedId,
    p_origen: origen,
  })
  registrarFalla(error, `auditoria_accesos:${origen}`)
}
