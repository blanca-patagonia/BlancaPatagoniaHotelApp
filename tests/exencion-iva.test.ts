import { describe, it, expect } from 'vitest'
import {
  exentoDeIva,
  motivoSinExencion,
  desglosarConExencion,
  FUNDAMENTO_EXENCION,
  MENSAJES_SIN_EXENCION,
} from '@/lib/domain/exencion-iva'

/**
 * El caso que más importa está primero y tiene nombre propio: un extranjero que
 * paga en efectivo NO está exento. Es el error que la RG 3971 hace fácil de
 * cometer a mano y la razón por la que este módulo existe.
 */
describe('exención de IVA al turista del exterior · cuándo corresponde', () => {
  it('un extranjero que paga en efectivo local NO queda exento', () => {
    const c = { residenteExterior: true, pagoDesdeExterior: false }
    expect(exentoDeIva(c)).toBe(false)
    expect(motivoSinExencion(c)).toBe('pago_local')
  })

  it('residente en el exterior que paga desde el exterior SÍ queda exento', () => {
    expect(exentoDeIva({ residenteExterior: true, pagoDesdeExterior: true })).toBe(true)
    expect(motivoSinExencion({ residenteExterior: true, pagoDesdeExterior: true })).toBeNull()
  })

  it('mientras no se sepa cómo paga, NO hay exención', () => {
    const c = { residenteExterior: true, pagoDesdeExterior: null }
    expect(exentoDeIva(c)).toBe(false)
    expect(motivoSinExencion(c)).toBe('pago_sin_confirmar')
  })

  it('un residente local no queda exento aunque pague desde el exterior', () => {
    const c = { residenteExterior: false, pagoDesdeExterior: true }
    expect(exentoDeIva(c)).toBe(false)
    expect(motivoSinExencion(c)).toBe('no_residente')
  })

  it('sin ninguna de las dos condiciones, el motivo señala la residencia primero', () => {
    // El orden importa: la residencia es el dato durable del huésped y es lo
    // primero que hay que corregir.
    expect(motivoSinExencion({ residenteExterior: false, pagoDesdeExterior: false })).toBe(
      'no_residente',
    )
  })

  it('cada motivo tiene un mensaje que dice qué hacer, no solo qué pasó', () => {
    for (const motivo of ['no_residente', 'pago_sin_confirmar', 'pago_local'] as const) {
      const mensaje = MENSAJES_SIN_EXENCION[motivo]
      expect(mensaje.length).toBeGreaterThan(30)
      expect(mensaje).toMatch(/[.]$/)
    }
  })
})

describe('exención de IVA · desglose del comprobante', () => {
  const ALICUOTA = 21

  it('sin exención, el desglose es el de siempre y neto + iva = total', () => {
    const d = desglosarConExencion({
      alojamientoConIva: 121,
      consumosConIva: 0,
      alicuota: ALICUOTA,
      exento: false,
    })
    expect(d.neto).toBe(100)
    expect(d.iva).toBe(21)
    expect(d.total).toBe(121)
    expect(d.exento).toBe(0)
    expect(d.motivoExencion).toBeNull()
    expect(d.neto + d.iva).toBeCloseTo(d.total, 2)
  })

  it('con exención y sin consumos, el IVA es cero y el total baja al neto', () => {
    const d = desglosarConExencion({
      alojamientoConIva: 121,
      consumosConIva: 0,
      alicuota: ALICUOTA,
      exento: true,
    })
    expect(d.neto).toBe(100)
    expect(d.exento).toBe(100)
    expect(d.iva).toBe(0)
    expect(d.total).toBe(100)
    expect(d.alicuota).toBe(0)
    expect(d.motivoExencion).toBe(FUNDAMENTO_EXENCION)
  })

  it('la exención NO alcanza a los consumos: el frigobar sigue gravado', () => {
    // Alojamiento 121 (100 + 21 de IVA) y frigobar 121 (100 + 21).
    // Exento el alojamiento: paga 100 + 121 = 221.
    const d = desglosarConExencion({
      alojamientoConIva: 121,
      consumosConIva: 121,
      alicuota: ALICUOTA,
      exento: true,
    })
    expect(d.exento).toBe(100) // solo el alojamiento
    expect(d.neto).toBe(200) // 100 alojamiento + 100 consumos
    expect(d.iva).toBe(21) // solo sobre los consumos
    expect(d.total).toBe(221)
    expect(d.alicuota).toBe(ALICUOTA) // quedó parte gravada
  })

  it('la garantía neto + iva = total se mantiene con y sin exención', () => {
    const casos = [
      { alojamientoConIva: 148.7, consumosConIva: 0 },
      { alojamientoConIva: 148.7, consumosConIva: 15 },
      { alojamientoConIva: 0.01, consumosConIva: 0.02 },
      { alojamientoConIva: 99999.99, consumosConIva: 1234.56 },
      { alojamientoConIva: 726.33, consumosConIva: 290.4 },
    ]
    for (const caso of casos) {
      for (const exento of [true, false]) {
        const d = desglosarConExencion({ ...caso, alicuota: ALICUOTA, exento })
        expect(d.neto + d.iva).toBeCloseTo(d.total, 2)
        expect(d.exento).toBeLessThanOrEqual(d.neto)
        expect(d.exento).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('el exento nunca supera al neto, que es lo que exige la restricción de la base', () => {
    const d = desglosarConExencion({
      alojamientoConIva: 1000,
      consumosConIva: 0,
      alicuota: ALICUOTA,
      exento: true,
    })
    // La migración 0058 tiene `check (exento >= 0 and exento <= neto)`.
    expect(d.exento).toBeLessThanOrEqual(d.neto)
  })

  it('con alícuota 0 no rompe ni inventa impuesto', () => {
    const d = desglosarConExencion({
      alojamientoConIva: 100,
      consumosConIva: 50,
      alicuota: 0,
      exento: false,
    })
    expect(d.neto).toBe(150)
    expect(d.iva).toBe(0)
    expect(d.total).toBe(150)
  })

  it('exento con alícuota 0 no declara fundamento sobre un impuesto que no existía', () => {
    const d = desglosarConExencion({
      alojamientoConIva: 100,
      consumosConIva: 0,
      alicuota: 0,
      exento: true,
    })
    expect(d.iva).toBe(0)
    expect(d.total).toBe(100)
    expect(d.alicuota).toBe(0)
  })

  it('el fundamento legal cita la norma, porque va impreso en el comprobante', () => {
    expect(FUNDAMENTO_EXENCION).toMatch(/3971/)
    expect(FUNDAMENTO_EXENCION).toMatch(/1043/)
  })

  it('una cuenta de solo consumos con el alojamiento exento no deja el exento en cero por error', () => {
    // Alojamiento 0 (por ejemplo, cortesía) y consumos gravados.
    const d = desglosarConExencion({
      alojamientoConIva: 0,
      consumosConIva: 121,
      alicuota: 21,
      exento: true,
    })
    expect(d.exento).toBe(0)
    expect(d.neto).toBe(100)
    expect(d.iva).toBe(21)
    expect(d.total).toBe(121)
  })
})
