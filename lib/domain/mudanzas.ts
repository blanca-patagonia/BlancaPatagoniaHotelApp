import { ocupaInventario, type EstadoReserva } from './reservas'

/**
 * Cambio de unidad de una reserva ("mudanza").
 *
 * Situación real de recepción: se rompe el calefactor, el huésped pide otra
 * habitación, o hay que liberar una unidad para acomodar un grupo. Hasta acá el
 * sistema asignaba la unidad al crear la reserva y **no había forma de
 * cambiarla**.
 *
 * Reglas puras. La garantía de que la unidad destino esté libre NO vive acá: la
 * impone la restricción de exclusión sobre `estadias` (ADR 0002). Este módulo
 * decide lo que la base no puede decidir: si la mudanza corresponde, qué pasa
 * con la tarifa y si la unidad liberada queda sucia.
 */

/** Por qué una mudanza no se puede hacer. */
export type MotivoRechazoMudanza = 'finalizada' | 'sin_inventario' | 'misma_unidad'

export const MENSAJES_RECHAZO_MUDANZA: Record<MotivoRechazoMudanza, string> = {
  finalizada: 'La estadía ya terminó: no se puede cambiar la unidad.',
  sin_inventario: 'Una reserva cancelada o no-show no ocupa ninguna unidad.',
  misma_unidad: 'La unidad de destino es la misma que la actual.',
}

/**
 * ¿Se puede mudar una reserva en este estado?
 *
 * Se apoya en `ocupaInventario` en lugar de repetir la lista: si la reserva no
 * bloquea una unidad, no hay nada que mudar. Así, si mañana cambia el conjunto
 * de estados activos, esta regla lo sigue solo.
 */
export function puedeCambiarUnidad(estado: EstadoReserva): boolean {
  return ocupaInventario(estado)
}

/** Motivo por el que se rechaza la mudanza, o `null` si se puede hacer. */
export function motivoRechazoMudanza(
  estado: EstadoReserva,
  unidadActual: string,
  unidadDestino: string,
): MotivoRechazoMudanza | null {
  if (unidadActual === unidadDestino) return 'misma_unidad'
  if (estado === 'checkout') return 'finalizada'
  if (!puedeCambiarUnidad(estado)) return 'sin_inventario'
  return null
}

/**
 * ¿La unidad que se libera queda sucia?
 *
 * Solo si el huésped llegó a ocuparla físicamente (`in_house`). Mudar una
 * reserva que todavía no hizo el check-in no ensucia nada, y marcarla sucia le
 * daría trabajo inventado a las mucamas.
 */
export function requiereLimpieza(estado: EstadoReserva): boolean {
  return estado === 'in_house'
}

/* ─────────────────────────────────────────────────────── tarifa ──── */

/**
 * Qué hacer con el precio cuando la unidad destino es de otro tipo.
 *
 * No hay una respuesta única: si la mudanza la decide el hotel (una avería, una
 * cortesía) el huésped no debe pagar la diferencia; si la pide el huésped para
 * mejorar, sí. Por eso lo elige quien opera, y el sistema solo se asegura de
 * que la opción sea coherente.
 */
export type PoliticaTarifa = 'mantener' | 'recotizar'

/**
 * ¿Hay que volver a cotizar la estadía?
 *
 * Dentro del mismo tipo de unidad el precio es idéntico por definición (la
 * tarifa se carga por tipo, no por habitación), así que recotizar sería trabajo
 * inútil y arriesgaría cambiar el total por un redondeo.
 */
export function debeRecotizar(politica: PoliticaTarifa, tipoDestinoEsDistinto: boolean): boolean {
  return tipoDestinoEsDistinto && politica === 'recotizar'
}

/** Texto que queda registrado en la auditoría de la mudanza. */
export function describirMudanza(
  unidadOrigen: string,
  unidadDestino: string,
  motivo: string,
): string {
  const limpio = motivo.trim()
  const base = `Cambio de unidad: ${unidadOrigen} → ${unidadDestino}`
  return limpio ? `${base}. Motivo: ${limpio}` : base
}
