/**
 * Datos operativos del hotel que todavía no están modelados en la base.
 *
 * Los horarios, la dirección y los servicios son política del hotel y hoy no
 * tienen tabla propia. Viven acá, en **un solo lugar**, hasta que exista una de
 * configuración general.
 *
 * Por qué este archivo: estas constantes estaban repetidas en tres módulos
 * (`lib/asistente`, el alta de reservas del panel y la del portal público). El
 * riesgo no era el duplicado en sí, sino que el hotel cambiara el horario de
 * check-in y quedaran dos respuestas distintas conviviendo: el asistente
 * diciendo una hora y el email de confirmación otra.
 *
 * Lo que SÍ está en la base no va acá: tarifas, temporadas y políticas de
 * cancelación se leen de sus tablas.
 */

/** Hora a partir de la cual la habitación está disponible. */
export const HORA_CHECK_IN = '15:00'

/** Hora límite para desocupar la habitación. */
export const HORA_CHECK_OUT = '10:00'

/** Ubicación, tal como se le comunica al huésped. */
export const DIRECCION = 'El Calafate, Santa Cruz'

/** Hoy el hotel no admite mascotas. */
export const ADMITE_MASCOTAS = false

/** Servicios incluidos o disponibles, para las respuestas al huésped. */
export const SERVICIOS = [
  'desayuno',
  'wifi',
  'estacionamiento',
  'calefacción central',
  'habitaciones con vista al lago e hidromasaje',
  'cabañas con hogar a leña y parrilla',
]
