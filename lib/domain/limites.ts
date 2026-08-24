/**
 * Límites de volumen de las entradas públicas (lógica pura).
 *
 * Cada número tiene un porqué escrito. Un límite sin justificación se termina
 * ajustando a ojo cuando alguien se queja, y ahí deja de proteger.
 *
 * El criterio general: el techo tiene que estar **muy por encima** del uso
 * legítimo más intenso que se pueda imaginar, y **muy por debajo** del volumen
 * necesario para hacer daño. Cuando ese margen existe, el límite no molesta a
 * nadie real y sí frena a un script.
 */

export type AccionLimitada = 'reserva_publica' | 'login' | 'encuesta' | 'recuperar_password'

export interface Limite {
  /** Intentos permitidos dentro de la ventana. */
  maximo: number
  /** Ventana en minutos. */
  minutos: number
  /** Qué se está protegiendo. Va al código y a la documentación. */
  motivo: string
}

export const LIMITES: Record<AccionLimitada, Limite> = {
  /*
    El más importante. Cada reserva pendiente bloquea una unidad durante 5 días,
    y el hotel tiene 15: sin límite, unas pocas decenas de envíos dejan al hotel
    sin nada vendible por casi una semana.

    Una familia que reserva para varias habitaciones podría enviar el formulario
    tres o cuatro veces seguidas; cinco por hora deja lugar de sobra para eso.
    Un ataque necesitaría cientos.
  */
  reserva_publica: {
    maximo: 5,
    minutos: 60,
    motivo: 'Cada reserva pendiente bloquea una unidad por 5 días.',
  },

  /*
    Diez intentos en quince minutos tolera a quien no recuerda bien su
    contraseña —el caso real más común— y corta la fuerza bruta mucho antes de
    que sea útil. Supabase Auth ya limita del lado del servidor; esto agrega el
    registro local y frena antes de llegar.
  */
  login: {
    maximo: 10,
    minutos: 15,
    motivo: 'Fuerza bruta contra las cuentas del personal.',
  },

  /*
    Recuperación de contraseña. Tres por hora y por IP.

    Dos cosas que protege, y la segunda es la que importa:

    · Que nadie use el formulario como ametralladora de correos contra la casilla
      de un empleado.
    · Que no se pueda **enumerar cuentas**. La pantalla responde siempre lo mismo
      exista o no el email —eso ya cierra la vía obvia—, pero sin límite un script
      podría medir tiempos de respuesta sobre miles de direcciones. Tres por hora
      hace que eso no escale.

    Es más bajo que el del login a propósito: olvidarse la contraseña y pedir el
    enlace tres veces en una hora ya es raro; teclearla mal diez veces, no.
  */
  recuperar_password: {
    maximo: 3,
    minutos: 60,
    motivo: 'Enumeración de cuentas del staff y correo no solicitado.',
  },

  /*
    Una encuesta se responde una vez. Tres por hora cubre a quien recarga o se
    equivoca, y evita que se inflen los promedios de NPS, que alimentan los
    reportes de gestión.
  */
  encuesta: {
    maximo: 3,
    minutos: 60,
    motivo: 'El NPS alimenta los reportes de gestión.',
  },
}

/** Mensaje para el visitante. No revela el límite exacto ni si acertó algo. */
export function mensajeLimite(accion: AccionLimitada): string {
  const minutos = LIMITES[accion].minutos
  return accion === 'login'
    ? `Demasiados intentos. Esperá unos minutos y volvé a probar.`
    : `Recibimos varios envíos desde tu conexión. Probá de nuevo en ${minutos} minutos, o escribinos y lo resolvemos por teléfono.`
}
