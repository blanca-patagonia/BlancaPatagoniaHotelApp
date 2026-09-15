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
  | 'ical'
  | 'webhook_pago'
  | 'webhook_email'
  | 'webhook_canal_externo'
  | 'comprobante_agencia'
  | 'payway_ejecutar_pago'

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
    El feed iCal de salida. No filtra datos personales —el archivo dice «ocupado» y
    nada más— pero cada lectura recorre un año de estadías, así que sin techo la URL
    es un amplificador gratis para cualquiera que la tenga.

    El techo es alto a propósito. El hotel tiene 11 tipos de unidad, y si Booking,
    Airbnb y Expedia sondean cada uno todos los feeds una vez por hora son 33
    lecturas legítimas: un límite ajustado cortaría la sincronización, que es
    justamente el daño que este feed viene a evitar. Ciento veinte deja margen de
    sobra y sigue cortando un bucle, que haría miles.
  */
  ical: {
    maximo: 120,
    minutos: 60,
    motivo: 'Cada lectura recorre un año de estadías.',
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

  // Mismo criterio que webhook_pago: se cuenta DESPUÉS de rechazar el token,
  // nunca antes, para no bloquear una racha de reservas legítimas de un
  // channel manager real (Fase 7, preparación).
  webhook_canal_externo: {
    maximo: 20,
    minutos: 60,
    motivo: 'Martilleo del webhook de canales externos por parte de quien no tiene el token.',
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
    Subida de comprobante de pago desde el portal del socio, sin sesión de
    staff: el token de la URL es la única credencial. Sin techo, quien lo tenga
    podría llenar el bucket privado de archivos (cada uno pesa hasta 8 MB) y
    ensuciar la cuenta corriente con filas de «pago pendiente» sin comprobante
    real detrás.

    Diez por hora deja margen de sobra para el caso legítimo más intenso: una
    agencia que liquida el mes y sube el comprobante de varias reservas
    seguidas. Un script que quisiera llenar el bucket necesitaría cientos.
  */
  comprobante_agencia: {
    maximo: 10,
    minutos: 60,
    motivo: 'El bucket privado y la cuenta corriente, desde un enlace sin sesión de staff.',
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
}

/** Mensaje para el visitante. No revela el límite exacto ni si acertó algo. */
export function mensajeLimite(accion: AccionLimitada): string {
  const minutos = LIMITES[accion].minutos
  return accion === 'login'
    ? `Demasiados intentos. Esperá unos minutos y volvé a probar.`
    : `Recibimos varios envíos desde tu conexión. Probá de nuevo en ${minutos} minutos, o escribinos y lo resolvemos por teléfono.`
}
