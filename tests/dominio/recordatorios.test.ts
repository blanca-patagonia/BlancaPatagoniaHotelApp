import { describe, it, expect } from 'vitest'
import {
  DIAS_ANTES_DE_LLEGAR,
  DIAS_ANTES_DE_VENCER,
  DIAS_DESPUES_DE_SALIR,
  DIAS_EXPIRACION,
  PUNTAJE_MINIMO_RESENA,
  mereceLaPenaPedirResena,
  ventanasDeAviso,
} from '@/lib/domain/recordatorios'

/**
 * Las ventanas de los recordatorios automáticos.
 *
 * Son **decisiones del hotel** —«avisamos del saldo siete días antes»— y por eso
 * están en el dominio y tienen test: escritas dentro de un `.gte()` de una
 * consulta no se pueden leer ni discutir.
 */

describe('las ventanas de una corrida', () => {
  const v = ventanasDeAviso('2027-03-10')

  it('el recordatorio de llegada y el de salida miran mañana', () => {
    expect(v.llegadaManana).toBe('2027-03-11')
    expect(v.salidaManana).toBe('2027-03-11')
  })

  it('el de saldo mira una semana adelante', () => {
    expect(v.llegadaConSaldo).toBe('2027-03-17')
    expect(diasDeDiferencia('2027-03-10', v.llegadaConSaldo)).toBe(DIAS_ANTES_DE_LLEGAR)
  })

  it('el pedido de reseña mira hacia ATRÁS', () => {
    // El signo importa: con el día equivocado se le pediría una reseña a alguien
    // que todavía no se fue.
    expect(v.salidaParaResena).toBe('2027-03-07')
    expect(diasDeDiferencia(v.salidaParaResena, '2027-03-10')).toBe(DIAS_DESPUES_DE_SALIR)
  })

  it('el aviso de vencimiento sale ANTES de que la reserva se libere', () => {
    /*
      ⚠️ El test que importa de este módulo.

      La reserva se libera a los `DIAS_EXPIRACION` días de creada. Si la ventana
      del aviso fuera igual o mayor, el correo saldría **después** de que el
      sistema ya soltó la unidad: le estaría diciendo al huésped que tiene 24
      horas para señar algo que ya no existe.
    */
    const antiguedadQueAvisa = diasDeDiferencia(v.creadaAntesDe, '2027-03-10')
    expect(antiguedadQueAvisa).toBeLessThan(DIAS_EXPIRACION)
    expect(antiguedadQueAvisa).toBe(DIAS_EXPIRACION - DIAS_ANTES_DE_VENCER)
  })

  it('cruza el fin de mes sin inventar días', () => {
    const finDeMes = ventanasDeAviso('2027-01-30')
    expect(finDeMes.llegadaManana).toBe('2027-01-31')
    expect(finDeMes.llegadaConSaldo).toBe('2027-02-06')

    // Y el año, que es donde un `setDate` casero se rompe.
    const finDeAnio = ventanasDeAviso('2027-12-31')
    expect(finDeAnio.llegadaManana).toBe('2028-01-01')
  })
})

describe('a quién se le pide una reseña', () => {
  it('sólo a quien puntuó bien', () => {
    /*
      Pedirle una reseña pública a quien puntuó bajo es pedirle que publique su
      queja: el hotel se estaría pagando la mala reseña que quizás no iba a
      escribir. A ése hay que llamarlo, no pedirle difusión.
    */
    expect(mereceLaPenaPedirResena(10)).toBe(true)
    expect(mereceLaPenaPedirResena(PUNTAJE_MINIMO_RESENA)).toBe(true)
    expect(mereceLaPenaPedirResena(PUNTAJE_MINIMO_RESENA - 1)).toBe(false)
    expect(mereceLaPenaPedirResena(0)).toBe(false)
  })

  it('a quien NO respondió tampoco', () => {
    // Sin señal, la apuesta es a ciegas y el costo de equivocarse es público y
    // permanente. `null` y `undefined` son el mismo caso: no contestó.
    expect(mereceLaPenaPedirResena(null)).toBe(false)
    expect(mereceLaPenaPedirResena(undefined)).toBe(false)
  })

  it('el umbral está dentro de la escala NPS', () => {
    expect(PUNTAJE_MINIMO_RESENA).toBeGreaterThanOrEqual(0)
    expect(PUNTAJE_MINIMO_RESENA).toBeLessThanOrEqual(10)
  })
})

/** Días entre dos fechas ISO, contados sin depender de `lib/fechas`. */
function diasDeDiferencia(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`)
  const b = Date.parse(`${hasta}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}
