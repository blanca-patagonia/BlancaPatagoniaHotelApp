import 'server-only'

/**
 * Estado de cobro de una reserva: cuánto debe, cuánto pagó y qué links tiene
 * vivos.
 *
 * Existe por la misma razón que `saldar.ts`: el portal público y el mostrador
 * necesitan responder exactamente la misma pregunta, y cuando esa regla estuvo
 * duplicada **divergió** —una copia consolidaba consumos y la otra no—, con el
 * resultado de que el huésped veía un saldo y recepción veía otro.
 *
 * La cuenta es alojamiento **más consumos**, no solo el alojamiento. Un huésped
 * que pagó su estadía y consumió del frigobar no está saldado.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, seniaSugerida, type Pago } from '@/lib/domain/pagos'
import { linkVigente } from '@/lib/domain/cobro'
import { parsearPeriodo, diasEntre } from '@/lib/fechas'

/* eslint-disable @typescript-eslint/no-explicit-any --
   Mismo motivo que en `lib/payments/servicio.ts`: esto lo llaman el cliente del
   usuario (mostrador) y el `service_role` (portal público, donde el huésped no
   tiene sesión), y sus tipos generados no coinciden. */
type Cliente = SupabaseClient<any, any, any>

/** Un link de pago todavía utilizable. */
export interface LinkVivo {
  externalId: string
  url: string
  monto: number
  moneda: string
  montoCobrado: number | null
  tipo: string
  venceEn: string | null
}

export interface EstadoCobro {
  /** Alojamiento + consumos. Es contra esto que se mide el saldo. */
  total: number
  alojamiento: number
  consumos: number
  pagado: number
  saldo: number
  saldada: boolean
  tieneSenia: boolean
  /** Seña sugerida: la primera noche (Tarifario). */
  senia: number
  noches: number
  /** Links de pago vivos, del más nuevo al más viejo. */
  linksVivos: LinkVivo[]
}

/**
 * Lee el estado de cobro.
 *
 * Devuelve `null` sólo si la reserva no existe o si **algún dato de plata no se
 * pudo leer**. No devuelve un resumen parcial a propósito: un total calculado
 * sin los consumos es más bajo que el real y llevaría a cobrar de menos, que es
 * peor que no mostrar nada.
 */
export async function estadoDeCobro(
  cliente: Cliente,
  reservaId: string,
): Promise<EstadoCobro | null> {
  const [reserva, pagos, consumos, estadias] = await Promise.all([
    cliente.from('reservas').select('total').eq('id', reservaId).maybeSingle(),
    cliente
      .from('pagos')
      .select('tipo, monto, estado, external_id, url_pago, vence_en, moneda, monto_cobrado')
      .eq('reserva_id', reservaId)
      .order('creado_en', { ascending: false }),
    cliente.from('consumos').select('cantidad, precio_unitario').eq('reserva_id', reservaId),
    cliente.from('estadias').select('periodo').eq('reserva_id', reservaId),
  ])

  if (reserva.error || pagos.error || consumos.error || estadias.error) {
    console.error(
      `[cobro] no se pudo leer el estado de la reserva ${reservaId}: ` +
        [reserva.error, pagos.error, consumos.error, estadias.error]
          .filter(Boolean)
          .map((e) => e!.message)
          .join(' · '),
    )
    return null
  }
  if (!reserva.data) return null

  const cuenta = cuentaConsolidada(
    Number(reserva.data.total),
    (consumos.data ?? []).map((c) => ({
      cantidad: c.cantidad as number,
      precioUnitario: Number(c.precio_unitario),
    })) as Consumo[],
  )

  const filas = pagos.data ?? []
  const resumen = resumenPagos(
    cuenta.total,
    filas.map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado })) as Pago[],
  )

  // Las noches salen de la estadía; sin ella la seña sugerida cae al total.
  const periodo = estadias.data?.[0] ? parsearPeriodo(estadias.data[0].periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0

  const ahora = new Date()
  const linksVivos: LinkVivo[] = filas
    .filter((p) => p.estado === 'pendiente' && p.url_pago && linkVigente(p.vence_en, ahora))
    .map((p) => ({
      externalId: p.external_id as string,
      url: p.url_pago as string,
      monto: Number(p.monto),
      moneda: String(p.moneda ?? 'USD'),
      montoCobrado: p.monto_cobrado === null ? null : Number(p.monto_cobrado),
      tipo: String(p.tipo),
      venceEn: p.vence_en as string | null,
    }))

  return {
    total: cuenta.total,
    alojamiento: cuenta.alojamiento,
    consumos: cuenta.consumos,
    pagado: resumen.pagado,
    saldo: resumen.saldo,
    saldada: resumen.saldada,
    tieneSenia: resumen.tieneSenia,
    senia: seniaSugerida(cuenta.total, noches),
    noches,
    linksVivos,
  }
}
