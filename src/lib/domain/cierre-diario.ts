/**
 * Cierre del día (night audit), lógica pura.
 *
 * Patrón de referencia: el night audit de Hotel PMS — el repaso de fin de día
 * antes de cerrarlo: quién llegó, quién no aparareció, quién se fue, cuánto
 * entró y de qué manera.
 *
 * Es de **solo lectura**: no marca no-shows ni cierra nada por su cuenta. Un
 * cierre que actúa por sí solo sobre reservas o plata es demasiado riesgo para
 * inferir sin que el hotel confirme la regla de negocio (ver ADR 0019,
 * todavía sin decidir). Esto es el repaso; decidir qué hacer con lo que
 * muestra sigue siendo de una persona.
 */

import type { EstadoReserva } from './reservas'
import type { MedioPago } from './pagos'

export interface MovimientoDelDia {
  tipo: 'llegada' | 'salida'
  estado: EstadoReserva
}

export interface ResumenMovimientos {
  llegadasPrevistas: number
  /** Llegó de verdad: la estadía pasó a `in_house` o ya hizo `checkout`. */
  llegadasEfectivas: number
  /** Tenía que llegar y la reserva terminó en `no_show`. */
  noShows: number
  salidasPrevistas: number
  /** Se fue de verdad: la estadía está en `checkout`. */
  salidasEfectivas: number
}

const LLEGO: readonly EstadoReserva[] = ['in_house', 'checkout']

export function resumenMovimientos(movs: readonly MovimientoDelDia[]): ResumenMovimientos {
  const r: ResumenMovimientos = {
    llegadasPrevistas: 0,
    llegadasEfectivas: 0,
    noShows: 0,
    salidasPrevistas: 0,
    salidasEfectivas: 0,
  }
  for (const m of movs) {
    if (m.tipo === 'llegada') {
      r.llegadasPrevistas++
      if (LLEGO.includes(m.estado)) r.llegadasEfectivas++
      if (m.estado === 'no_show') r.noShows++
    } else {
      r.salidasPrevistas++
      if (m.estado === 'checkout') r.salidasEfectivas++
    }
  }
  return r
}

export interface PagoDelDia {
  medio: MedioPago
  monto: number
}

/** Total cobrado por medio de pago. Ceros para los medios sin movimiento. */
export function totalPorMedio(
  pagos: readonly PagoDelDia[],
  medios: readonly MedioPago[],
): Record<MedioPago, number> {
  const totales = Object.fromEntries(medios.map((m) => [m, 0])) as Record<MedioPago, number>
  for (const p of pagos) totales[p.medio] = (totales[p.medio] ?? 0) + p.monto
  return totales
}
