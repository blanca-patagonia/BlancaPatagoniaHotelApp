import { motivoRechazoMudanza, type MotivoRechazoMudanza } from './mudanzas'
import type { EstadoReserva } from './reservas'

/**
 * Arrastrar una reserva en la grilla de ocupación.
 *
 * Lo pidió el hotel mirando WinPAX: agarrar el bloque de una reserva con el
 * mouse y soltarlo en otra habitación. Es exactamente la mudanza que ya existe
 * (migración 0028, `lib/domain/mudanzas.ts`) con otra forma de pedirla, así que
 * este módulo **no** reimplementa esas reglas: las llama.
 *
 * Lo que sí decide acá es lo que la mudanza no sabía porque nadie se lo
 * preguntaba: **si el destino está libre para todo el período**. La grilla
 * tiene ese dato en pantalla y puede responder antes de ir al servidor, que es
 * lo que permite que una celda ocupada ni siquiera acepte el bloque.
 *
 * ⚠️ Esa respuesta anticipada es una comodidad, **nunca la garantía**. La
 * garantía sigue siendo la restricción de exclusión sobre `estadias` (ADR 0002):
 * entre que se dibuja la grilla y se suelta el bloque, otra recepcionista pudo
 * vender esa unidad. Por eso `cambiar_unidad_reserva` vuelve a comprobar todo y
 * la pantalla sabe mostrar el rechazo 23P01.
 *
 * El arrastre mueve de HABITACIÓN, no de fechas. Correr las fechas recotiza la
 * estadía —cambia lo que el huésped paga— y eso no puede salir de un gesto que
 * se dispara sin querer: sigue estando en la pantalla de reprogramar.
 */

/** Por qué no se puede soltar un bloque acá. */
export type MotivoRechazoArrastre =
  | MotivoRechazoMudanza
  | 'destino_inactivo'
  | 'ocupada'

export const MENSAJES_RECHAZO_ARRASTRE: Record<MotivoRechazoArrastre, string> = {
  misma_unidad: 'La reserva ya está en esa unidad.',
  finalizada: 'La estadía ya terminó: no se puede cambiar la unidad.',
  sin_inventario: 'Una reserva cancelada o no-show no ocupa ninguna unidad.',
  destino_inactivo: 'Esa unidad está dada de baja.',
  ocupada: 'Esa unidad ya está ocupada en esas fechas.',
}

/** El bloque que se agarra: una estadía entera, no la noche que se clickeó. */
export interface BloqueArrastrable {
  reservaId: string
  unidadId: string
  estado: EstadoReserva
  /** Primera noche, inclusive. */
  desde: string
  /** Día de salida, EXCLUSIVO — igual que `periodo` en la base. */
  hasta: string
}

/** Un tramo ocupado de la unidad de destino. */
export interface TramoOcupado {
  desde: string
  hasta: string
}

/**
 * ¿Dos períodos `[desde, hasta)` se pisan?
 *
 * El fin es excluido en los dos, así que una reserva que sale el 12 y otra que
 * entra el 12 **no** se solapan: es el día de rotación de la habitación, y
 * tratarlo como conflicto le haría perder una noche vendible al hotel por cada
 * salida. Es la misma semántica del `daterange` de Postgres, a propósito.
 */
export function haySolape(a: TramoOcupado, b: TramoOcupado): boolean {
  return a.desde < b.hasta && b.desde < a.hasta
}

/**
 * Motivo por el que no se puede soltar el bloque en esta unidad, o `null` si se
 * puede.
 *
 * `ocupacionDestino` son los tramos que la unidad de destino ya tiene tomados.
 * Se excluye el propio bloque antes de comparar: arrastrar una reserva sobre sí
 * misma no es un conflicto, es un gesto que no cambia nada —y lo atrapa
 * `misma_unidad`, que da un mensaje que se entiende.
 */
export function motivoRechazoArrastre(
  bloque: BloqueArrastrable,
  destino: { id: string; activa: boolean },
  ocupacionDestino: readonly TramoOcupado[],
): MotivoRechazoArrastre | null {
  const rechazo = motivoRechazoMudanza(bloque.estado, bloque.unidadId, destino.id)
  if (rechazo) return rechazo
  if (!destino.activa) return 'destino_inactivo'
  if (ocupacionDestino.some((t) => haySolape(bloque, t))) return 'ocupada'
  return null
}

/**
 * ¿La grilla vio lo suficiente como para responder por su cuenta?
 *
 * La grilla trae las estadías que **se solapan con la ventana** que muestra. De
 * ahí sale una garantía que no es obvia y conviene dejar escrita: si el bloque
 * arrastrado entra entero en la ventana, cualquier estadía que pudiera chocar
 * con él tiene que solaparse con el bloque, y por lo tanto con la ventana, y por
 * lo tanto **ya está en pantalla**. La comprobación local es completa.
 *
 * En cuanto el bloque se sale de la ventana —una estadía larga vista a 14
 * días—, deja de serlo: puede haber un choque en un tramo que nadie trajo. Ahí
 * el arrastre no bloquea el gesto (bloquearlo sería inventar un conflicto que
 * quizá no existe): deja que conteste la base, que es la única que ve todo.
 */
export function ventanaAlcanza(
  bloque: Pick<BloqueArrastrable, 'desde' | 'hasta'>,
  ventana: TramoOcupado,
): boolean {
  return bloque.desde >= ventana.desde && bloque.hasta <= ventana.hasta
}
