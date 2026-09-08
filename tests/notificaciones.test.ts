import { describe, it, expect } from 'vitest'
import {
  MAX_INTENTOS,
  HORA_DESDE,
  HORA_HASTA,
  agotoIntentos,
  claveDeNotificacion,
  cuandoEnviar,
  dentroDeHorario,
  esInmediato,
  esperaDeReintento,
  horaDelHotel,
  motivoNoNotificar,
  esComercial,
  ESTADOS_NOTIFICACION,
  ETIQUETAS_ESTADO,
  SIGNIFICADO_ESTADO,
  esEstadoNotificacion,
  sePuedeReintentar,
  rolDelAviso,
  ROL_DEL_AVISO,
} from '@/lib/domain/notificaciones'
import { EVENTOS_EMAIL, EVENTOS_INTERNOS } from '@/lib/domain/plantillas'

/**
 * Reglas de la bandeja de salida (migración 0075).
 *
 * Lo que se prueba acá es lo que decide **cuándo** y **si** se le escribe a un
 * huésped. El envío en sí lo cubre `tests/notificaciones-bandeja.test.ts`.
 */

describe('reintentos', () => {
  it('la espera crece', () => {
    const esperas = [0, 1, 2, 3, 4].map(esperaDeReintento)
    for (let i = 1; i < esperas.length; i++) {
      expect(esperas[i], `el intento ${i} no espera más que el anterior`).toBeGreaterThan(
        esperas[i - 1],
      )
    }
  })

  /*
    El techo importa tanto como el crecimiento. Sin él, el quinto intento caería
    días después y el recordatorio de check-in llegaría con el huésped ya
    alojado: un mensaje que llega tarde puede ser peor que uno que no llega.
  */
  it('la espera está acotada: todo cabe en unas doce horas', () => {
    const total = [0, 1, 2, 3, 4].reduce((a, i) => a + esperaDeReintento(i), 0)
    expect(total, 'los reintentos se estiran demasiado').toBeLessThanOrEqual(12 * 60)
  })

  it('un intento fuera de escala no rompe', () => {
    expect(esperaDeReintento(99)).toBe(esperaDeReintento(4))
    expect(esperaDeReintento(-1)).toBe(esperaDeReintento(0))
  })

  it('se rinde al llegar al máximo', () => {
    expect(agotoIntentos(MAX_INTENTOS - 1)).toBe(false)
    expect(agotoIntentos(MAX_INTENTOS)).toBe(true)
  })
})

describe('horario permitido', () => {
  /** Un instante UTC que en el hotel (UTC−3) es la hora pedida. */
  function enElHotel(hora: number): Date {
    return new Date(Date.UTC(2026, 8, 15, hora + 3, 30))
  }

  it('la hora se lee en la zona del hotel, no en la del servidor', () => {
    // 00:30 UTC son las 21:30 del día anterior en El Calafate. Es el mismo
    // defecto que la auditoría anterior encontró en `hoyISO()`.
    expect(horaDelHotel(new Date('2026-09-16T00:30:00.000Z'))).toBe(21)
  })

  it('media tarde está dentro y la madrugada no', () => {
    expect(dentroDeHorario(enElHotel(15))).toBe(true)
    expect(dentroDeHorario(enElHotel(3))).toBe(false)
  })

  it('los bordes son [desde, hasta)', () => {
    expect(dentroDeHorario(enElHotel(HORA_DESDE))).toBe(true)
    expect(dentroDeHorario(enElHotel(HORA_HASTA)), 'la hora de cierre no debe entrar').toBe(false)
  })

  /*
    La confirmación de reserva no espera, y es la decisión importante: el huésped
    acaba de reservar y está esperando ese correo. Demorarlo hasta las 9 de la
    mañana no es cortesía, es dejarlo sin saber si su reserva entró.
  */
  it('la confirmación sale al instante aunque sea de madrugada', () => {
    expect(esInmediato('confirmacion_reserva')).toBe(true)
    expect(cuandoEnviar('confirmacion_reserva', enElHotel(3))).toBeNull()
  })

  it('un recordatorio de madrugada se corre a la mañana', () => {
    const cuando = cuandoEnviar('recordatorio_checkin', enElHotel(3))
    expect(cuando, 'se mandó de madrugada').not.toBeNull()
    expect(horaDelHotel(cuando!)).toBe(HORA_DESDE)
  })

  it('un recordatorio de la noche se corre al día siguiente', () => {
    const noche = enElHotel(23)
    const cuando = cuandoEnviar('recordatorio_checkin', noche)
    expect(cuando).not.toBeNull()
    expect(horaDelHotel(cuando!)).toBe(HORA_DESDE)
    expect(cuando!.getTime(), 'lo mandó para atrás').toBeGreaterThan(noche.getTime())
  })

  it('dentro de la franja no se demora nada', () => {
    expect(cuandoEnviar('recordatorio_checkin', enElHotel(15))).toBeNull()
  })
})

describe('consentimiento', () => {
  /*
    Los dos campos no son lo mismo, y el default es distinto a propósito: lo
    transaccional lleva el consentimiento implícito en la transacción, lo
    comercial exige opt-in. Meterlos en una sola columna es el error caro —apaga
    los avisos que el huésped necesita, o manda publicidad sin permiso—.
  */
  it('sin ficha de preferencias no se bloquea nada', () => {
    expect(motivoNoNotificar('confirmacion_reserva', null)).toBeNull()
  })

  it('un aviso transaccional sale por omisión', () => {
    expect(
      motivoNoNotificar('confirmacion_reserva', {
        acepta_avisos: true,
        acepta_promociones: false,
      }),
    ).toBeNull()
  })

  it('quien pidió no recibir avisos no los recibe, y se dice por qué', () => {
    const motivo = motivoNoNotificar('recordatorio_checkin', {
      acepta_avisos: false,
      acepta_promociones: true,
    })
    expect(motivo, 'se le escribió igual').not.toBeNull()
    expect(motivo).toContain('no recibir')
  })
})

describe('clave de idempotencia', () => {
  it('el mismo evento sobre la misma entidad da la misma clave', () => {
    expect(claveDeNotificacion('confirmacion_reserva', 'r1')).toBe(
      claveDeNotificacion('confirmacion_reserva', 'r1'),
    )
  })

  it('dos eventos distintos sobre la misma entidad no colisionan', () => {
    expect(claveDeNotificacion('confirmacion_reserva', 'r1')).not.toBe(
      claveDeNotificacion('recordatorio_checkin', 'r1'),
    )
  })

  /*
    El discriminante es lo que deja que una reserva reprogramada vuelva a recibir
    aviso. Sin él la clave sería `recordatorio_checkin:<reserva>` y esa reserva no
    recibiría recordatorio nunca más.
  */
  it('el discriminante separa dos avisos legítimos del mismo evento', () => {
    const a = claveDeNotificacion('recordatorio_checkin', 'r1', '2027-03-10')
    const b = claveDeNotificacion('recordatorio_checkin', 'r1', '2027-04-20')
    expect(a).not.toBe(b)
  })
})

/**
 * Las decisiones que un evento nuevo obliga a tomar (catálogo ampliado).
 */
describe('el catálogo ampliado y sus reglas', () => {
  it('los avisos internos NO esperan al horario', () => {
    /*
      La franja de 9 a 21 protege al huésped de que le escriban de madrugada. Un
      aviso interno aterriza en la cartelera del hotel: demorarlo hasta las 9 es
      justo lo contrario de lo que se busca — «entró una reserva» sirve cuando
      entró, no a la mañana siguiente.
    */
    for (const e of EVENTOS_INTERNOS) {
      expect(esInmediato(e), `${e} tendría que salir al instante`).toBe(true)
    }
  })

  it('los avisos internos NO pasan por el consentimiento del huésped', () => {
    // Preguntarle a `acepta_avisos` si el hotel puede enterarse de que entró una
    // reserva no tiene sentido: el que dijo «no me escriban» dejaría al hotel sin
    // la novedad.
    const rechaza = { acepta_avisos: false, acepta_promociones: false }
    for (const e of EVENTOS_INTERNOS) {
      expect(motivoNoNotificar(e, rechaza), `${e} se bloqueó por consentimiento`).toBeNull()
    }
  })

  it('lo que el huésped espera sale al instante; lo que inicia el hotel, no', () => {
    // Acaba de pagar y quiere el comprobante.
    expect(esInmediato('pago_recibido')).toBe(true)
    expect(esInmediato('pago_rechazado')).toBe(true)
    expect(esInmediato('reserva_confirmada')).toBe(true)
    // El hotel los inicia: pueden esperar a una hora decente.
    expect(esInmediato('saldo_pendiente')).toBe(false)
    expect(esInmediato('checkout_proximo')).toBe(false)
    expect(esInmediato('solicitud_resena')).toBe(false)
  })

  it('la reserva por vencer sale al instante, aunque la inicie el hotel', () => {
    // Es la excepción, y tiene motivo: la reserva se libera mañana. Esperar al
    // horario le come horas útiles al aviso.
    expect(esInmediato('reserva_por_vencer')).toBe(true)
  })

  it('sólo el pedido de reseña es comercial', () => {
    /*
      El criterio no es el tono: es de quién es el interés. Todos los demás le
      informan al huésped algo de SU reserva; el pedido de reseña le pide un favor
      al hotel.

      ⚠️ La encuesta de satisfacción NO es comercial: sirve para arreglar lo que
      estuvo mal en la estadía de esa persona, así que es operación. Confundirlas
      dejaría al hotel sin saber que alguien se fue disconforme.
    */
    expect(esComercial('solicitud_resena')).toBe(true)
    expect(esComercial('encuesta_postcheckout')).toBe(false)

    const sinPromos = { acepta_avisos: true, acepta_promociones: false }
    expect(motivoNoNotificar('solicitud_resena', sinPromos)).toContain('comerciales')
    expect(motivoNoNotificar('encuesta_postcheckout', sinPromos)).toBeNull()
  })

  it('cada evento del catálogo tiene decidida su inmediatez', () => {
    // No comprueba un valor: comprueba que la función responda para todos. Un
    // evento nuevo que nadie clasificó cae en `false` por omisión, y eso es una
    // decisión tomada por descarte.
    for (const e of EVENTOS_EMAIL) {
      expect(typeof esInmediato(e), `${e} sin clasificar`).toBe('boolean')
    }
  })
})

describe('los cinco estados del envío', () => {
  it('están los cinco que pide el pedido, más «cancelada»', () => {
    /*
      El pedido original nombra cinco: enviado, entregado, leído, fallido y
      pendiente. La 0075 tenía cuatro y le faltaban justamente los dos que sólo
      puede informar el proveedor.
    */
    for (const e of ['pendiente', 'enviada', 'entregada', 'leida', 'fallida'] as const) {
      expect(ESTADOS_NOTIFICACION, `falta el estado «${e}»`).toContain(e)
    }
    // `cancelada` no es un desenlace del envío sino la decisión de no mandarlo.
    expect(ESTADOS_NOTIFICACION).toContain('cancelada')
  })

  it('«enviada» y «entregada» son estados distintos, y la diferencia está escrita', () => {
    /*
      ⚠️ Es el punto entero de haber agregado los dos estados. El proveedor acepta
      el mensaje y responde 200 mucho antes de saber si el servidor del
      destinatario lo aceptó: entre las dos cosas está el rebote, que es el caso
      que el hotel necesita ver —«le escribimos y no le llegó»—.

      Si alguien las fusiona «porque son lo mismo», este test falla.
    */
    expect(SIGNIFICADO_ESTADO.enviada).not.toBe(SIGNIFICADO_ESTADO.entregada)
    expect(SIGNIFICADO_ESTADO.enviada).toMatch(/no se sabe/i)
  })

  it('la ausencia de «leída» no prueba nada, y el texto lo dice', () => {
    // Un cliente de correo que bloquea imágenes nunca reporta la apertura. Que la
    // pantalla afirmara «no la leyó» sería inventar un dato.
    expect(SIGNIFICADO_ESTADO.leida).toMatch(/bloquean|NO lo diga/i)
  })

  it('cada estado tiene etiqueta y significado', () => {
    for (const e of ESTADOS_NOTIFICACION) {
      expect(ETIQUETAS_ESTADO[e], `${e} sin etiqueta`).toBeTruthy()
      expect(SIGNIFICADO_ESTADO[e]?.length ?? 0, `${e} sin explicación`).toBeGreaterThan(20)
    }
  })

  it('reconoce los estados válidos y rechaza el resto', () => {
    expect(esEstadoNotificacion('entregada')).toBe(true)
    expect(esEstadoNotificacion('leida')).toBe(true)
    expect(esEstadoNotificacion('enviado')).toBe(false) // en masculino no existe
    expect(esEstadoNotificacion('')).toBe(false)
  })

  it('sólo se reintenta lo fallido y lo cancelado', () => {
    /*
      Reintentar algo ya entregado le mandaría al huésped el mismo aviso dos
      veces, que es exactamente lo que la bandeja existe para evitar. Y lo
      pendiente no está trabado: está esperando su turno.
    */
    expect(sePuedeReintentar('fallida')).toBe(true)
    expect(sePuedeReintentar('cancelada')).toBe(true)
    expect(sePuedeReintentar('pendiente')).toBe(false)
    expect(sePuedeReintentar('enviada')).toBe(false)
    expect(sePuedeReintentar('entregada')).toBe(false)
    expect(sePuedeReintentar('leida')).toBe(false)
  })
})

describe('a quién le toca cada aviso interno', () => {
  it('todos los internos tienen rol, y ninguno del huésped lo tiene', () => {
    for (const e of EVENTOS_INTERNOS) {
      expect(rolDelAviso(e), `${e} sin rol asignado`).toBeTruthy()
    }
    // El destinatario de un aviso al huésped es una dirección, no un puesto.
    expect(rolDelAviso('confirmacion_reserva')).toBeNull()
    expect(rolDelAviso('solicitud_resena')).toBeNull()
  })

  it('el rol asignado es uno de los cuatro que existen', () => {
    // Un rol inventado dejaría el aviso fuera del `check` de la 0086 y la fila no
    // entraría: el aviso no llegaría a nadie y el motivo sería un error de la base.
    for (const rol of Object.values(ROL_DEL_AVISO)) {
      expect(['admin', 'gerencia', 'recepcion', 'housekeeping']).toContain(rol)
    }
  })

  it('lo que se atiende en el mostrador va a recepción; lo que se decide, a gerencia', () => {
    expect(rolDelAviso('interno_nueva_reserva')).toBe('recepcion')
    expect(rolDelAviso('interno_nuevo_pago')).toBe('recepcion')
    expect(rolDelAviso('interno_habitacion_lista')).toBe('recepcion')
    expect(rolDelAviso('interno_error_sincronizacion')).toBe('gerencia')
    expect(rolDelAviso('interno_discrepancia_factura')).toBe('gerencia')
  })

  it('un aviso interno nunca se bloquea por consentimiento del huésped', () => {
    /*
      Va a la cartelera del hotel, no al huésped. Si el consentimiento aplicara,
      un huésped que pidió no recibir avisos dejaría al hotel sin enterarse de que
      entró su propia reserva.
    */
    const noQuiereNada = { acepta_avisos: false, acepta_promociones: false }
    for (const e of EVENTOS_INTERNOS) {
      expect(motivoNoNotificar(e, noQuiereNada), `${e} bloqueado`).toBeNull()
    }
  })
})
