import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'

/**
 * Saldo de una reserva con la cuenta CONSOLIDADA (alojamiento + consumos), o
 * el error si no se pudo leer.
 *
 * Los avisos al huésped (recordatorio de seña, aviso de check-out, cobro
 * acreditado) lo calculaban cada uno por su lado y descartaban el error de las
 * lecturas: si fallaba la de pagos, el saldo salía igual al total y se le
 * recordaba pagar la seña a alguien que ya la había pagado. Acá, una lectura
 * fallida es un error y no un «no hay pagos».
 */
export async function leerSaldoReserva(
  client: SupabaseClient,
  reservaId: string,
  total: number,
): Promise<{ saldo: number; resumen: ReturnType<typeof resumenPagos> } | { error: string }> {
  const [pagos, consumos] = await Promise.all([
    client.from('pagos').select('tipo, monto, estado').eq('reserva_id', reservaId),
    client.from('consumos').select('cantidad, precio_unitario').eq('reserva_id', reservaId),
  ])
  if (pagos.error || consumos.error) return { error: (pagos.error ?? consumos.error)!.message }

  const cuenta = cuentaConsolidada(
    Number(total),
    (consumos.data ?? []).map((c) => ({
      cantidad: (c as { cantidad: number }).cantidad,
      precioUnitario: Number((c as { precio_unitario: number }).precio_unitario),
    })) as Consumo[],
  )
  const resumen = resumenPagos(cuenta.total, (pagos.data ?? []) as Pago[])
  return { saldo: resumen.saldo, resumen }
}
