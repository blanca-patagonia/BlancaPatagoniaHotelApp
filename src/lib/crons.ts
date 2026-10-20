import 'server-only'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { registrarErrorSync } from '@/lib/registro'
import type { NombreCron } from '@/lib/domain/crons'

/**
 * Anota el resultado de una corrida de cron en `cron_corridas` (migración 0117).
 *
 * Nunca lanza: anotar es accesorio y no puede cambiar la respuesta del cron.
 * Si falla, queda en el log del servidor.
 */
export async function anotarCorrida(nombre: NombreCron, ok: boolean, detalle = ''): Promise<void> {
  try {
    const ahora = new Date().toISOString()
    const { error } = await crearClienteAdmin()
      .from('cron_corridas')
      .upsert(
        ok
          ? { nombre, ultima_ok: ahora, actualizado_en: ahora }
          : { nombre, ultima_falla: ahora, detalle_falla: detalle.slice(0, 500), actualizado_en: ahora },
        { onConflict: 'nombre' },
      )
    if (error) registrarErrorSync('cron_corrida_no_anotada', { nombre, detalle: error.message })
  } catch (e) {
    registrarErrorSync('cron_corrida_no_anotada', {
      nombre,
      detalle: e instanceof Error ? e.message : String(e),
    })
  }
}
