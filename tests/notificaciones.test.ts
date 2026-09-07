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
} from '@/lib/domain/notificaciones'

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
