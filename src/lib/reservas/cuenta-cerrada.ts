import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { motivoNoCargable, type MotivoNoCargable } from '@/lib/domain/servicio'

/**
 * ¿Se puede tocar la cuenta de estas reservas (cargar, mover o quitar cargos)?
 *
 * La cuenta se cierra con la FACTURA (`motivoNoCargable`): un cargo que entra,
 * cambia de folio o desaparece después de emitido el comprobante —inmutable,
 * migración 0034— deja la cuenta contradiciendo lo facturado. `agregarConsumo`
 * y `quitarConsumo` ya lo comprobaban; el folio (carga manual, mover de
 * folio) y el punto de venta (cerrar y anular comandas) no, y por ahí se
 * podía cobrar o anular un consumo de una cuenta ya facturada.
 *
 * Fail-closed: si no se pudo leer, se devuelve el error y NO se deja pasar.
 */
export async function motivoCuentaCerrada(
  client: SupabaseClient,
  reservaIds: string[],
): Promise<{ error: string } | { motivo: MotivoNoCargable | null }> {
  const ids = [...new Set(reservaIds.filter(Boolean))]
  if (ids.length === 0) return { motivo: null }

  const [{ data: reservas, error: eReservas }, { data: facturas, error: eFacturas }] =
    await Promise.all([
      client.from('reservas').select('id, estado').in('id', ids),
      client.from('facturas').select('reserva_id').in('reserva_id', ids),
    ])
  if (eReservas || eFacturas) return { error: (eReservas ?? eFacturas)!.message }

  const facturadas = new Set((facturas ?? []).map((f) => f.reserva_id as string))
  for (const r of reservas ?? []) {
    const motivo = motivoNoCargable(String(r.estado), facturadas.has(r.id as string))
    if (motivo) return { motivo }
  }
  return { motivo: null }
}
