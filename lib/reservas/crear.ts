import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { diasEntre } from '@/lib/fechas'
import type { TarifaTipo } from '@/lib/domain/precios'
import type { EstadoReserva } from '@/lib/domain/reservas'

/**
 * Alta de reserva compartida por el panel interno (recepción) y el portal público.
 * Centraliza el flujo crítico: elegir una unidad libre del tipo pedido, cotizar y
 * crear la reserva de forma atómica (la restricción de exclusión evita overbooking).
 * El `client` define el contexto de seguridad (RLS del recepcionista o `service_role`).
 */

export interface ParamsReserva {
  tipoUnidadId: string
  checkIn: string
  checkOut: string
  huespedes: number
  huespedId: string
  canal: string
  tarifaTipo: TarifaTipo
  estado: EstadoReserva
}

export type ResultadoReserva =
  | { ok: true; reserva: { id: string; codigo: string; total: number | string } }
  | { ok: false; error: string }

export async function crearReservaEnUnidadLibre(
  client: SupabaseClient,
  p: ParamsReserva,
): Promise<ResultadoReserva> {
  // 1) Buscar una unidad libre del tipo elegido.
  const { data: libres } = await client.rpc('unidades_disponibles', {
    desde: p.checkIn,
    hasta: p.checkOut,
    p_categoria: null,
  })
  const unidad = ((libres ?? []) as { id: string; tipo_unidad_id: string }[]).find(
    (u) => u.tipo_unidad_id === p.tipoUnidadId,
  )
  if (!unidad) {
    return { ok: false, error: 'No hay unidades disponibles de ese tipo para esas fechas.' }
  }

  // 2) Cotizar según el canal.
  const cot = await cotizarEstadia({
    tipoUnidadId: p.tipoUnidadId,
    checkIn: p.checkIn,
    checkOut: p.checkOut,
    tarifaTipo: p.tarifaTipo,
  })
  if (cot.faltanTarifas) {
    return { ok: false, error: 'No hay tarifa cargada para todas esas fechas.' }
  }
  const noches = diasEntre(p.checkIn, p.checkOut)
  const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0

  // 3) Alta atómica (anti-overbooking en la base).
  const { data: reserva, error } = await client.rpc('crear_reserva', {
    p_huesped_id: p.huespedId,
    p_unidad_id: unidad.id,
    p_tipo_unidad_id: p.tipoUnidadId,
    p_check_in: p.checkIn,
    p_check_out: p.checkOut,
    p_huespedes: p.huespedes,
    p_precio_noche: precioNoche,
    p_total: cot.resumen.total,
    p_canal: p.canal,
    p_tarifa_tipo: p.tarifaTipo,
    p_estado: p.estado,
  })
  if (error) {
    if (error.code === '23P01') {
      return { ok: false, error: 'La unidad ya no está disponible para esas fechas.' }
    }
    return { ok: false, error: `No se pudo crear la reserva: ${error.message}` }
  }
  return { ok: true, reserva: reserva as { id: string; codigo: string; total: number | string } }
}
