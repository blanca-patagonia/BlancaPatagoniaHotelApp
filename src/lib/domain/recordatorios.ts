/**
 * Cuándo corresponde cada recordatorio (lógica pura).
 *
 * ── Por qué las ventanas están acá y no en la consulta ──────────────────────
 *
 * Porque son **decisiones**, no detalles de implementación: «avisamos del saldo
 * siete días antes» es una política del hotel, y escrita dentro de un `.gte()`
 * no se puede leer, ni discutir, ni testear. Acá cada una tiene su número, su
 * nombre y el motivo por el que es ése y no otro.
 *
 * Nada de este módulo toca la base ni conoce a Supabase.
 */

import { sumarDias } from '@/lib/fechas'

/**
 * Días que una reserva pendiente retiene la unidad antes de liberarse.
 *
 * ⚠️ Tiene que coincidir con el `p_dias` que
 * `app/api/cron/mantenimiento/route.ts` le pasa a `expirar_reservas_pendientes`.
 * Si acá fuera mayor, el aviso saldría **después** de que la reserva ya se
 * liberó — o sea, avisándole al huésped de algo que ya pasó.
 */
export const DIAS_EXPIRACION = 5

/** Cuánta anticipación tiene el aviso de que la reserva se libera. */
export const DIAS_ANTES_DE_VENCER = 1

/**
 * Anticipación del recordatorio de saldo.
 *
 * Una semana: alcanza para que el huésped decida y pague sin apuro, y todavía
 * está lo bastante cerca del viaje como para que le importe. Antes de eso, un
 * correo sobre una estadía de marzo mandado en enero se archiva y se olvida.
 */
export const DIAS_ANTES_DE_LLEGAR = 7

/**
 * Cuántos días después del check-out se pide la reseña.
 *
 * Tres: el suficiente para que el huésped ya haya llegado a su casa y la estadía
 * siga fresca. El mismo día del check-out está viajando, y a los quince ya no se
 * acuerda de los detalles que hacen buena una reseña.
 */
export const DIAS_DESPUES_DE_SALIR = 3

/**
 * Puntaje mínimo de la encuesta para pedirle una reseña pública.
 *
 * ⚠️ Ocho, que es el piso de «pasivo» alto en la escala NPS. Pedirle una reseña
 * a quien puntuó bajo es pedirle que publique su queja, y el hotel se estaría
 * pagando la mala reseña que quizás no iba a escribir. A quien puntuó mal hay que
 * llamarlo, no pedirle difusión.
 *
 * Quien **no respondió** la encuesta tampoco recibe el pedido: sin señal, la
 * apuesta es a ciegas y el costo de equivocarse es público y permanente.
 */
export const PUNTAJE_MINIMO_RESENA = 8

/** ¿Corresponde pedirle una reseña a quien puntuó así? */
export function mereceLaPenaPedirResena(puntaje: number | null | undefined): boolean {
  if (puntaje === null || puntaje === undefined) return false
  return puntaje >= PUNTAJE_MINIMO_RESENA
}

/** Las fechas que cada recordatorio necesita, a partir de «hoy» en el hotel. */
export interface VentanasDeAviso {
  /** Llegan mañana: recordatorio de check-in. */
  llegadaManana: string
  /** Salen mañana: aviso de check-out. */
  salidaManana: string
  /** Llegan en una semana: recordatorio de saldo. */
  llegadaConSaldo: string
  /** Salieron hace tres días: pedido de reseña. */
  salidaParaResena: string
  /**
   * Las reservas pendientes creadas **antes** de este instante se liberan
   * mañana. Es un `date` y no un `timestamptz` a propósito: la expiración
   * también trabaja por días.
   */
  creadaAntesDe: string
}

/**
 * Calcula las cinco ventanas de una corrida.
 *
 * Recibe «hoy» en vez de leerlo: es lo que permite que el test fije el día y no
 * dependa de cuándo se ejecute.
 */
export function ventanasDeAviso(hoy: string): VentanasDeAviso {
  return {
    llegadaManana: sumarDias(hoy, 1),
    salidaManana: sumarDias(hoy, 1),
    llegadaConSaldo: sumarDias(hoy, DIAS_ANTES_DE_LLEGAR),
    salidaParaResena: sumarDias(hoy, -DIAS_DESPUES_DE_SALIR),
    /*
      Se libera a los `DIAS_EXPIRACION` días de creada, y se avisa
      `DIAS_ANTES_DE_VENCER` antes: o sea que las candidatas son las creadas hace
      `5 - 1 = 4` días o más.

      El corte es «hace 4 días o más» y no «exactamente hace 4» porque la
      expiración puede haber estado caída: una reserva de hace 6 días que sigue
      pendiente también merece el aviso, y no dárselo por no encajar en un día
      exacto sería perder justo el caso raro.
    */
    creadaAntesDe: sumarDias(hoy, -(DIAS_EXPIRACION - DIAS_ANTES_DE_VENCER)),
  }
}
