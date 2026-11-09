/**
 * Cuánto retiene una reserva pendiente la unidad (lógica pura).
 */

/**
 * Días que una reserva pendiente retiene la unidad antes de liberarse.
 *
 * ⚠️ Es el único lugar donde vive este número: lo usan la tarea de
 * mantenimiento (`app/api/cron/mantenimiento/route.ts`), que se lo pasa a
 * `expirar_reservas_pendientes`, y las pantallas que le dicen al huésped hasta
 * cuándo tiene para pagar la seña. Con dos constantes, subir una sin la otra
 * le informaría al huésped un plazo que el sistema no respeta.
 */
export const DIAS_EXPIRACION = 5
