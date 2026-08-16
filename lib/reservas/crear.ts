import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { diasEntre } from '@/lib/fechas'
import type { TarifaTipo } from '@/lib/domain/precios'
import {
  segmentoDeCanal,
  type EstadoReserva,
  type Garantia,
  type Plan,
  type Segmento,
} from '@/lib/domain/reservas'
import type { Ocupantes } from '@/lib/domain/ocupantes'

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
  /**
   * Pax total. Si se pasa `ocupantes`, se ignora: el pax lo deriva
   * `crear_reserva` del desglose, para que las dos cosas no puedan contradecirse.
   */
  huespedes: number
  huespedId: string
  canal: string
  tarifaTipo: TarifaTipo
  estado: EstadoReserva

  /**
   * Desglose de ocupantes (paso 6). Opcional: sin él, `crear_reserva` asume que
   * todos los huéspedes son adultos, que es lo que el sistema suponía antes.
   */
  ocupantes?: Ocupantes
  /** «No mover»: el huésped pidió esta habitación en particular. */
  noMover?: boolean

  /** Datos comerciales (paso 6). Todos opcionales, con los valores por omisión de la base. */
  comercial?: {
    plan?: Plan
    garantia?: Garantia
    segmento?: Segmento
    voucher?: string
    contratoId?: string | null
    descuentoPct?: number
  }
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
  //
  // El cliente se pasa explícitamente. Antes no se pasaba y `cotizarEstadia`
  // creaba el suyo con `cookies()`, así que esta función —que recibe un cliente
  // justamente para poder correr con `service_role`— quedaba atada a una petición
  // HTTP y fallaba en cualquier otro contexto (webhook, tarea programada, test de
  // integración) con un error que no dejaba adivinar la causa.
  const cot = await cotizarEstadia({
    tipoUnidadId: p.tipoUnidadId,
    checkIn: p.checkIn,
    checkOut: p.checkOut,
    tarifaTipo: p.tarifaTipo,
    cliente: client,
  })
  if (cot.faltanTarifas) {
    return { ok: false, error: 'No hay tarifa cargada para todas esas fechas.' }
  }
  const noches = diasEntre(p.checkIn, p.checkOut)
  const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0

  // 3) Alta atómica (anti-overbooking en la base).
  //
  // El desglose de ocupantes y los datos comerciales viajan en la MISMA llamada, no
  // en un `update` posterior. Si fueran dos pasos, un fallo en el segundo dejaría
  // la reserva creada con la ficha a medias, que es justo lo que la atomicidad de
  // esta función evita. `crear_reserva` deriva `estadias.huespedes` del desglose
  // cuando se lo pasan, así que el pax y el detalle nunca nacen contradiciéndose.
  const o = p.ocupantes
  const c = p.comercial

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

    // Ocupación. `null` en `p_adultos` significa «sin desglose»: la función asume
    // que todos son adultos y conserva el comportamiento histórico.
    p_adultos: o ? o.adultos : null,
    p_menores: o?.menores ?? 0,
    p_bebes: o?.bebes ?? 0,
    p_camas_extra: o?.camasExtra ?? 0,
    p_cunas: o?.cunas ?? 0,
    p_no_mover: p.noMover ?? false,

    // Comercial.
    p_plan: c?.plan ?? 'desayuno',
    p_garantia: c?.garantia ?? 'sin_garantia',
    // Si no lo indican, se deriva del canal: una venta por OTA es del segmento OTA
    // por definición, y pedirlo dos veces sólo habilita que se contradigan.
    p_segmento: c?.segmento ?? segmentoDeCanal(p.canal),
    p_voucher: c?.voucher ?? '',
    p_contrato_id: c?.contratoId ?? null,
    p_descuento_pct: c?.descuentoPct ?? 0,

    // Desglose de importes: sale de la cotización, no se recibe de afuera. Así el
    // desglose y el total no pueden discrepar, y el listado puede mostrar la
    // tarifa con o sin impuestos sin recalcular nada.
    p_subtotal: cot.resumen.subtotalNeto,
    p_total_neto: cot.resumen.totalNeto,
    p_iva: cot.resumen.iva,
  })
  if (error) {
    if (error.code === '23P01') {
      return { ok: false, error: 'La unidad ya no está disponible para esas fechas.' }
    }
    return { ok: false, error: `No se pudo crear la reserva: ${error.message}` }
  }
  return { ok: true, reserva: reserva as { id: string; codigo: string; total: number | string } }
}
