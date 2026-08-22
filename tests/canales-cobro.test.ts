import { describe, it, expect } from 'vitest'
import {
  clasificarCobro,
  contarCobros,
  interpretarModalidadCobro,
  referenciaTransferenciaCanal,
  ETIQUETAS_MODALIDAD,
  ETIQUETAS_SITUACION,
  MODALIDADES_COBRO,
  SITUACIONES_COBRO,
  SITUACIONES_QUE_PIDEN_ACCION,
  type EntradaClasificacion,
} from '@/lib/domain/canales-cobro'

const HOY = '2027-06-15'

describe('cobro del canal · interpretar la forma de pago del informe', () => {
  it('reconoce que cobra el canal', () => {
    for (const v of [
      'Pago online',
      'Prepago',
      'Prepaid',
      'Tarjeta virtual',
      'Virtual card',
      'Payments by Booking.com',
      'Cobrado por el canal',
    ]) {
      expect(interpretarModalidadCobro(v), `no reconoció «${v}»`).toBe('canal')
    }
  })

  it('reconoce que cobra el hotel', () => {
    for (const v of [
      'Pago en el hotel',
      'En la propiedad',
      'At property',
      'Pago en el establecimiento',
      'Se paga en el alojamiento',
      'Cobro en mostrador',
    ]) {
      expect(interpretarModalidadCobro(v), `no reconoció «${v}»`).toBe('hotel')
    }
  })

  it('ignora acentos y mayúsculas', () => {
    // El informe sale en el idioma de la cuenta y no siempre con los mismos acentos.
    expect(interpretarModalidadCobro('PAGÓ ONLINE')).toBe('canal')
    expect(interpretarModalidadCobro('Pagó en el Hotél')).toBe('hotel')
  })

  it('«pago online en Booking.com» gana el canal, aunque diga las dos cosas', () => {
    // Contiene términos de las dos familias. La que manda es quién tiene la plata:
    // si el canal ya cobró, el mostrador no tiene nada que cobrar.
    expect(interpretarModalidadCobro('Pago online en Booking.com')).toBe('canal')
  })

  it('lo que NO reconoce cae en desconocida, nunca en una suposición', () => {
    // Es la regla más importante del módulo. Adivinar mal cuesta plata en las dos
    // direcciones: reclamarle una transferencia a Booking por algo que el huésped ya
    // pagó, o dejar salir a alguien sin cobrarle.
    for (const v of ['', null, undefined, 'Efectivo', 'Transferencia', 'N/D', '-', 'xyz']) {
      expect(interpretarModalidadCobro(v), `«${v}» no debería interpretarse`).toBe('desconocida')
    }
  })
})

describe('cobro del canal · clasificar la situación', () => {
  const base: EntradaClasificacion = {
    modalidad: 'hotel',
    checkOut: '2027-06-10',
    saldo: 100,
    importada: true,
  }

  it('una entrante sin importar no se clasifica', () => {
    // Sin reserva propia no hay pagos contra los que comparar: decir «salió sin
    // cobrar» de algo que no existe sería falso.
    expect(clasificarCobro({ ...base, importada: false }, HOY)).toBe('pendiente_de_estadia')
  })

  it('saldo cubierto cierra el caso, sin importar quién cobró', () => {
    expect(clasificarCobro({ ...base, saldo: 0 }, HOY)).toBe('al_dia')
    expect(clasificarCobro({ ...base, modalidad: 'canal', saldo: 0 }, HOY)).toBe('al_dia')
    expect(clasificarCobro({ ...base, modalidad: 'desconocida', saldo: 0 }, HOY)).toBe('al_dia')
  })

  it('tolera el redondeo de centavos al comparar el saldo', () => {
    expect(clasificarCobro({ ...base, saldo: 0.0005 }, HOY)).toBe('al_dia')
  })

  it('cobra el canal y hay saldo: falta la transferencia, sin importar la fecha', () => {
    // Booking cobra al reservar, así que la plata debería estar mucho antes del
    // check-in: no hay que esperar a que se vaya para reclamarla.
    expect(clasificarCobro({ ...base, modalidad: 'canal' }, HOY)).toBe('falta_transferencia')
    expect(clasificarCobro({ ...base, modalidad: 'canal', checkOut: '2027-12-01' }, HOY)).toBe(
      'falta_transferencia',
    )
  })

  it('cobra el hotel y hay saldo DESPUÉS del check-out: salió sin cobrar', () => {
    // Ésta es la lista que hoy no existía y es plata perdida real.
    expect(clasificarCobro({ ...base, checkOut: '2027-06-10' }, HOY)).toBe('salio_sin_cobrar')
    expect(clasificarCobro({ ...base, checkOut: HOY }, HOY)).toBe('salio_sin_cobrar')
  })

  it('cobra el hotel y hay saldo ANTES del check-out: es lo normal', () => {
    // El huésped paga cuando llega o cuando se va. Marcarlo como problema llenaría
    // la lista de ruido y nadie la mirararía.
    expect(clasificarCobro({ ...base, checkOut: '2027-07-01' }, HOY)).toBe('pendiente_de_estadia')
  })

  it('modalidad desconocida con saldo se reporta como tal', () => {
    expect(clasificarCobro({ ...base, modalidad: 'desconocida' }, HOY)).toBe('sin_determinar')
  })
})

describe('cobro del canal · conteo y riesgo', () => {
  it('cuenta cada situación y suma sólo lo que pide acción', () => {
    const filas: (EntradaClasificacion & { saldo: number })[] = [
      { modalidad: 'canal', checkOut: '2027-07-01', saldo: 300, importada: true },
      { modalidad: 'hotel', checkOut: '2027-06-01', saldo: 150, importada: true },
      { modalidad: 'desconocida', checkOut: '2027-06-01', saldo: 50, importada: true },
      { modalidad: 'hotel', checkOut: '2027-06-01', saldo: 0, importada: true },
      // Ésta NO suma al riesgo: todavía no llegó y no está pagada, que es lo normal.
      { modalidad: 'hotel', checkOut: '2027-09-01', saldo: 500, importada: true },
    ]

    const c = contarCobros(filas, HOY)
    expect(c.faltaTransferencia).toBe(1)
    expect(c.salioSinCobrar).toBe(1)
    expect(c.sinDeterminar).toBe(1)
    expect(c.alDia).toBe(1)
    expect(c.pendienteDeEstadia).toBe(1)
    // 300 + 150 + 50. Los 500 de la que todavía no llegó quedan afuera.
    expect(c.enRiesgo).toBe(500)
  })

  it('una lista vacía da todo en cero', () => {
    const c = contarCobros([], HOY)
    expect(c.enRiesgo).toBe(0)
    expect(c.alDia).toBe(0)
  })

  it('`pendiente_de_estadia` NO pide acción', () => {
    // Es la decisión que evita que la lista se llene de ruido.
    expect(SITUACIONES_QUE_PIDEN_ACCION).not.toContain('pendiente_de_estadia')
    expect(SITUACIONES_QUE_PIDEN_ACCION).not.toContain('al_dia')
  })
})

describe('cobro del canal · referencia de la transferencia', () => {
  it('arma una referencia estable por canal y liquidación', () => {
    expect(referenciaTransferenciaCanal('booking', 'LIQ-2027-06')).toBe(
      'booking-payout:LIQ-2027-06',
    )
  })

  it('la misma liquidación da la misma referencia', () => {
    // Es lo que hace que registrar dos veces la misma transferencia choque con el
    // unique de `pagos.external_id` en vez de duplicar la plata.
    expect(referenciaTransferenciaCanal('booking', 'X')).toBe(
      referenciaTransferenciaCanal('booking', 'X'),
    )
  })

  it('distingue canales', () => {
    expect(referenciaTransferenciaCanal('booking', 'X')).not.toBe(
      referenciaTransferenciaCanal('expedia', 'X'),
    )
  })
})

describe('cobro del canal · los catálogos están completos', () => {
  it('cada modalidad y cada situación tiene etiqueta en español', () => {
    for (const m of MODALIDADES_COBRO) expect(ETIQUETAS_MODALIDAD[m]).toBeTruthy()
    for (const s of SITUACIONES_COBRO) expect(ETIQUETAS_SITUACION[s]).toBeTruthy()
  })
})
