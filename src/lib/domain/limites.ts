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

export type AccionLimitada =
  | 'reserva_publica'
  | 'login'
  | 'encuesta'
  | 'recuperar_password'
  | 'webhook_pago'
  | 'webhook_email'
  | 'payway_ejecutar_pago'
  | 'pago_portal'
  | 'registro_firma_rechazada'

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

  /*
    El webhook de pagos, y **solo cuando la firma no valida**.

    Esta distinción es la decisión importante del límite, no el número. Un
    webhook de pagos es lo último que se debe limitar por volumen: cada evento
    que se descarta es un cobro del que el hotel no se entera. Si un fin de
    semana largo entran más avisos de los previstos y el limitador empieza a
    responder 429, la pasarela reintenta un rato y después se rinde: la plata
    quedó cobrada y la reserva figura impaga.

    Por eso el contador se incrementa **después** de rechazar la firma, nunca
    antes. Un evento legítimo —firmado con el secreto que solo tiene la
    pasarela— no pasa por acá jamás, por muchos que lleguen.

    Lo que sí protege: que alguien sin el secreto martille el endpoint. Cada
    intento cuesta un HMAC y, en MercadoPago, una consulta a su API. Veinte por
    hora y por IP es muchísimo para un error de configuración real —que se nota
    en el primer intento— y corta un bucle en seco.
  */
  webhook_pago: {
    maximo: 20,
    minutos: 60,
    motivo: 'Martilleo del webhook de pagos por parte de quien no tiene el secreto.',
  },

  /*
    El webhook de entrega de correo, con el mismo criterio y por el mismo motivo:
    el contador se incrementa **después** de rechazar la firma, nunca antes.

    Un evento legítimo llega firmado con el secreto que sólo tiene el proveedor,
    así que no pasa por acá jamás. Y descartar eventos buenos por volumen sería
    perder justamente los rebotes: el hotel volvería a creer que un correo llegó
    cuando no llegó, que es lo que este webhook viene a corregir.

    El techo es más alto que el de pagos porque el volumen legítimo también lo es
    —cada correo genera hasta cuatro eventos—, aunque los legítimos no cuenten.
  */
  webhook_email: {
    maximo: 40,
    minutos: 60,
    motivo: 'Martilleo del webhook de correo por parte de quien no tiene el secreto.',
  },


  /*
    Ejecutar un pago con Payway (`/pago-payway/[reservaId]`), sin sesión de
    staff: la única credencial es haber tokenizado una tarjeta. A diferencia
    de `webhook_pago` —que se cuenta después de rechazar la firma porque la
    pasarela real nunca pasa por ahí sin el secreto—, acá el que llega es
    SIEMPRE el propio huésped desde el navegador, así que el límite protege
    otra cosa: que un script no martille la API real de Payway (cada intento
    cuesta una llamada de verdad, y varios intentos con tarjetas al azar son
    la forma más barata de probar números robados).

    Diez por hora tolera al huésped que se equivoca de tarjeta un par de veces
    y a la familia que paga varias reservas seguidas; un script necesitaría
    cientos para tener alguna chance contra una sola tarjeta.
  */
  payway_ejecutar_pago: {
    maximo: 10,
    minutos: 60,
    motivo: 'Prueba de tarjetas contra la API real de Payway desde un checkout sin sesión.',
  },

  /*
    «Pagar» desde el enlace de la reserva (`/reservar/pagar/[token]`). En el
    camino normal no crea cobros de más —el link vivo se reutiliza—, pero si la
    pasarela falla cada intento vuelve a llamar a su API: sin techo, alguien
    con el token de su propia reserva podía martillar Mercado Pago o Stripe
    con la cuenta del hotel. Diez por hora cubre a quien prueba otro medio.
  */
  pago_portal: {
    maximo: 10,
    minutos: 60,
    motivo: 'Llamadas repetidas a la API de la pasarela con la cuenta del hotel.',
  },

  /*
    Cuántas firmas de webhook rechazadas por IP se guardan en `errores`. NO
    limita el webhook —eso es `webhook_pago`, que se cuenta después de la
    firma—: limita cuánto RUIDO entra al registro. Sin tope, alguien que manda
    firmas falsas sin parar llenaba `/panel/errores` y tapaba la causa más
    probable de que el hotel deje de ver pagos: un secreto mal copiado, que
    también se ve como «firma inválida».
  */
  registro_firma_rechazada: {
    maximo: 5,
    minutos: 10,
    motivo: 'Que firmas falsas en masa no tapen las señales reales en /panel/errores.',
  },

}

/** Mensaje para el visitante. No revela el límite exacto ni si acertó algo. */
export function mensajeLimite(accion: AccionLimitada): string {
  const minutos = LIMITES[accion].minutos
  return accion === 'login'
    ? `Demasiados intentos. Esperá unos minutos y volvé a probar.`
    : `Recibimos varios envíos desde tu conexión. Probá de nuevo en ${minutos} minutos, o escribinos y lo resolvemos por teléfono.`
}
