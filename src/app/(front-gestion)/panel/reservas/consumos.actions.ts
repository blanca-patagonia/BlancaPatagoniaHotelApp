'use server'

/**
 * Cargar y quitar consumos de la cuenta de una reserva, con la regla de cuenta
 * cerrada de `lib/reservas/cuenta-cerrada.ts`.
 */

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { cargarConsumo } from '@/lib/reservas/consumos'
import { cortarSiFalla } from '@/lib/acciones'

/** Carga un consumo (producto × cantidad) a la cuenta de la reserva. */
export async function agregarConsumo(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const reservaId = String(formData.get('reserva_id') ?? '')
  const productoId = String(formData.get('producto_id') ?? '')
  const cantidad = Math.max(1, Number(formData.get('cantidad') ?? 1) || 1)
  if (!reservaId || !productoId) redirect(`/panel/reservas/${reservaId}`)

  // La regla vive en `lib/reservas/consumos.ts`, compartida con el asistente de IA.
  const resultado = await cargarConsumo(await crearClienteServidor(), reservaId, productoId, cantidad)
  if (!resultado.ok) redirect(`/panel/reservas/${reservaId}?error=${resultado.clave}`)
  redirect(`/panel/reservas/${reservaId}`)
}

/** Quita un consumo de la cuenta. */
export async function quitarConsumo(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const reservaId = String(formData.get('reserva_id') ?? '')
  const consumoId = String(formData.get('consumo_id') ?? '')
  if (consumoId) {
    const supabase = await crearClienteServidor()
    /*
      La misma regla que al cargar: con la factura emitida la cuenta está
      cerrada. Antes se podía borrar un consumo ya facturado —la cuenta quedaba
      por debajo del comprobante (inmutable, 0034) y un pago posterior podía
      dar la reserva por saldada con menos de lo facturado—. Fail-closed: si no
      se puede leer la factura, no se borra.
    */
    const { data: factura, error: eFactura } = await supabase
      .from('facturas')
      .select('id')
      .eq('reserva_id', reservaId)
      .maybeSingle()
    cortarSiFalla(eFactura, `/panel/reservas/${reservaId}`, 'consumo_verificar')
    if (factura) redirect(`/panel/reservas/${reservaId}?error=quitar_consumo_facturado`)

    // Acotado a la reserva de la pantalla: un `consumo_id` de otra reserva no
    // se borra desde acá.
    const { error } = await supabase
      .from('consumos')
      .delete()
      .eq('id', consumoId)
      .eq('reserva_id', reservaId)
    cortarSiFalla(error, `/panel/reservas/${reservaId}`, 'quitar_consumo')
  }
  redirect(`/panel/reservas/${reservaId}`)
}
