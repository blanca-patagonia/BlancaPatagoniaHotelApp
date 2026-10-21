import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Promocion } from '@/lib/domain/precios'
import { hoyISO, diasEntre } from '@/lib/fechas'

/**
 * Las condiciones de precio de una reserva YA creada, para recotizarla.
 *
 * Reprogramar, mudar con recotización y la vista previa de la ficha vuelven a
 * cotizar la estadía. Hasta 2026-10 lo hacían sólo con la tarifa: la promoción
 * y el descuento adicional del mostrador se perdían en silencio al correr un
 * día la reserva —el huésped pasaba a pagar más sin que nadie lo decidiera—.
 * Este módulo es el único lugar que arma esas condiciones, así los tres flujos
 * (y lo que se muestra antes de confirmar) dan el mismo número.
 *
 * La promoción se respeta aunque hoy ya no esté vigente: es el trato que se
 * hizo al reservar, no una oferta nueva. Sus condiciones (noches mínimas,
 * anticipación) sí se vuelven a evaluar contra las fechas nuevas, y la
 * anticipación se cuenta desde el día en que se hizo la reserva.
 */
export interface CondicionesDePrecio {
  promocion: Promocion | null
  descuentoAdicionalPct: number
  /** Para las condiciones de anticipación de la promoción. */
  anticipacionDias: (checkIn: string) => number
}

export async function condicionesDePrecio(
  client: SupabaseClient,
  reservaId: string,
): Promise<{ ok: true; condiciones: CondicionesDePrecio } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('reservas')
    .select('descuento_pct, creada_en, promocion:promociones(tipo, valor, condiciones)')
    .eq('id', reservaId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'reserva inexistente' }

  // PostgREST tipa el embed to-one como arreglo cuando no puede probar la cardinalidad.
  const crudo = data.promocion as unknown
  const p = (Array.isArray(crudo) ? crudo[0] : crudo) as {
    tipo: string
    valor: number | string
    condiciones: Promocion['condiciones'] | null
  } | null

  const reservadoEl = hoyISO(new Date(String(data.creada_en)))
  return {
    ok: true,
    condiciones: {
      promocion: p
        ? { tipo: p.tipo as Promocion['tipo'], valor: Number(p.valor), condiciones: p.condiciones ?? {} }
        : null,
      descuentoAdicionalPct: Number(data.descuento_pct ?? 0),
      anticipacionDias: (checkIn) => Math.max(0, diasEntre(reservadoEl, checkIn)),
    },
  }
}

/**
 * ¿La reserva ya tiene factura? Con el comprobante emitido (inmutable, 0034)
 * no se puede cambiar el precio: el total de la reserva dejaría de coincidir
 * con lo facturado. Fail-closed: si no se puede leer, se informa el error.
 */
export async function estaFacturada(
  client: SupabaseClient,
  reservaId: string,
): Promise<{ ok: true; facturada: boolean } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('facturas')
    .select('id')
    .eq('reserva_id', reservaId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  return { ok: true, facturada: Boolean(data) }
}
