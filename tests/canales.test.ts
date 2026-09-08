import { describe, it, expect } from 'vitest'
import {
  tarifaDeCanal,
  validarReservaEntrante,
  esEventoMasReciente,
  detectarDiscrepancia,
  estadoSegunOperacion,
  describirDivergencia,
  type ReservaEntrante,
} from '@/lib/domain/canales'

const base: ReservaEntrante = {
  externalId: 'BK-12345',
  canal: 'booking',
  tipoUnidadCodigo: 'HOST-DOBLE',
  checkIn: '2026-04-10',
  checkOut: '2026-04-13',
  huespedes: 2,
  apellido: 'Pérez',
  email: 'perez@example.com',
  importeCanal: 300,
  monedaCanal: 'USD',
  operacion: 'nueva',
  emitidaEn: '2026-03-01T10:00:00Z',
}

describe('tarifaDeCanal', () => {
  it('una venta por OTA va a tarifa neto, no rack', () => {
    // Cobrarle rack a una OTA es facturar de más y después emitir nota de crédito.
    expect(tarifaDeCanal('booking')).toBe('neto')
    expect(tarifaDeCanal('expedia')).toBe('neto')
  })
})

describe('validarReservaEntrante', () => {
  it('acepta una reserva bien formada', () => {
    expect(validarReservaEntrante(base)).toEqual([])
  })

  it('rechaza sin identificador del canal: sin eso no hay idempotencia', () => {
    expect(validarReservaEntrante({ ...base, externalId: '  ' })).toContain(
      'Falta el identificador del canal (externalId).',
    )
  })

  it('rechaza una salida anterior o igual a la entrada', () => {
    expect(validarReservaEntrante({ ...base, checkOut: '2026-04-10' })).toContain(
      'La salida no puede ser anterior o igual a la entrada.',
    )
    expect(validarReservaEntrante({ ...base, checkOut: '2026-04-09' })).not.toEqual([])
  })

  it('rechaza fechas con formato inválido', () => {
    expect(validarReservaEntrante({ ...base, checkIn: '10/04/2026' })).toContain(
      'La fecha de entrada no es válida.',
    )
  })

  it('rechaza cantidades de huéspedes imposibles', () => {
    expect(validarReservaEntrante({ ...base, huespedes: 0 })).not.toEqual([])
    expect(validarReservaEntrante({ ...base, huespedes: 2.5 })).not.toEqual([])
  })

  it('acumula TODOS los motivos, no corta en el primero', () => {
    const rota = { ...base, externalId: '', apellido: '', huespedes: 0, monedaCanal: '' }
    // Quien reclame al canal necesita el detalle completo, no el primer síntoma.
    expect(validarReservaEntrante(rota).length).toBeGreaterThanOrEqual(4)
  })

  it('acepta importe cero: hay tarifas prepagas donde el canal informa 0', () => {
    expect(validarReservaEntrante({ ...base, importeCanal: 0 })).toEqual([])
  })
})

describe('esEventoMasReciente', () => {
  it('acepta el primer evento de una reserva', () => {
    expect(esEventoMasReciente('2026-03-01T10:00:00Z', null)).toBe(true)
  })

  it('acepta una modificación posterior', () => {
    expect(esEventoMasReciente('2026-03-02T10:00:00Z', '2026-03-01T10:00:00Z')).toBe(true)
  })

  it('DESCARTA un evento viejo que llega tarde', () => {
    // Los canales no garantizan orden: sin esto, un reenvío tardío pisaría el
    // estado correcto con uno anterior.
    expect(esEventoMasReciente('2026-03-01T10:00:00Z', '2026-03-02T10:00:00Z')).toBe(false)
  })

  it('descarta el mismo evento repetido', () => {
    expect(esEventoMasReciente('2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z')).toBe(false)
  })
})

describe('detectarDiscrepancia', () => {
  it('no avisa cuando coinciden', () => {
    expect(detectarDiscrepancia(300, 300).hay).toBe(false)
  })

  it('tolera el redondeo de conversión de moneda', () => {
    expect(detectarDiscrepancia(300, 300.3).hay).toBe(false)
  })

  it('avisa cuando el canal cobró de más', () => {
    const d = detectarDiscrepancia(300, 350)
    expect(d.hay).toBe(true)
    expect(d.diferencia).toBe(50)
    expect(d.detalle).toMatch(/más/)
  })

  it('avisa cuando el canal cobró de menos', () => {
    const d = detectarDiscrepancia(300, 250)
    expect(d.hay).toBe(true)
    expect(d.diferencia).toBe(-50)
    expect(d.detalle).toMatch(/menos/)
  })

  it('no arrastra error de punto flotante', () => {
    expect(detectarDiscrepancia(0.1 + 0.2, 0.3).hay).toBe(false)
  })
})

describe('estadoSegunOperacion', () => {
  it('una reserva de OTA entra confirmada, no pendiente', () => {
    // Como pendiente quedaría expuesta a la expiración automática y liberaría
    // una unidad que el canal ya vendió.
    expect(estadoSegunOperacion('nueva')).toBe('confirmada')
    expect(estadoSegunOperacion('modificada')).toBe('confirmada')
  })

  it('una cancelación del canal cancela', () => {
    expect(estadoSegunOperacion('cancelada')).toBe('cancelada')
  })
})

describe('el canal modifica una reserva ya importada (migración 0088)', () => {
  const IMPORTADO = {
    checkIn: '2026-04-10',
    checkOut: '2026-04-13',
    huespedes: 2,
    importeCanal: 300,
  }

  it('sin cambios devuelve null', () => {
    // Es el caso normal: el canal reenvía lo mismo en cada corrida. Marcar eso
    // como divergencia llenaría la lista de falsos positivos y nadie la miraría.
    expect(describirDivergencia(IMPORTADO, { ...IMPORTADO })).toBeNull()
  })

  it('detecta el cambio de fechas, que es el caro', () => {
    /*
      ⚠️ El caso que la 0074 dejaba abierto. La fila del canal se actualiza —bien,
      es lo que el canal afirma hoy— y la reserva del hotel se queda con las
      fechas viejas, sin ningún síntoma. Se descubre cuando el huésped llega.
    */
    const texto = describirDivergencia(IMPORTADO, { ...IMPORTADO, checkIn: '2026-04-12' })
    expect(texto).toContain('llegada')
    // Los DOS valores: la fila ya tiene el nuevo, así que sin el viejo no queda
    // rastro de qué había antes y no se puede saber qué corregir.
    expect(texto).toContain('2026-04-10')
    expect(texto).toContain('2026-04-12')
  })

  it('junta todos los cambios en un solo texto', () => {
    const texto = describirDivergencia(IMPORTADO, {
      checkIn: '2026-04-11',
      checkOut: '2026-04-15',
      huespedes: 3,
      importeCanal: 450,
    })
    for (const campo of ['llegada', 'salida', 'huéspedes', 'importe']) {
      expect(texto, `falta ${campo}`).toContain(campo)
    }
  })

  it('el importe tiene tolerancia de un centavo', () => {
    /*
      Dos `numeric` convertidos a `number` difieren por redondeo. Una alerta que
      suena siempre deja de mirarse, así que la diferencia tiene que ser real.
    */
    expect(describirDivergencia(IMPORTADO, { ...IMPORTADO, importeCanal: 300.004 })).toBeNull()
    expect(describirDivergencia(IMPORTADO, { ...IMPORTADO, importeCanal: 300.5 })).toContain(
      'importe',
    )
  })

  it('un importe que falta de un lado no cuenta como cambio', () => {
    // El feed iCal no trae importe. Compararlo contra el del CSV daría «cambió de
    // 300 a nada» en cada corrida del cron, que es ruido garantizado.
    expect(describirDivergencia(IMPORTADO, { ...IMPORTADO, importeCanal: null })).toBeNull()
    expect(
      describirDivergencia({ ...IMPORTADO, importeCanal: null }, IMPORTADO),
    ).toBeNull()
  })
})
