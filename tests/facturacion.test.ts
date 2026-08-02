import { describe, it, expect } from 'vitest'
import {
  tipoComprobante,
  discriminaIva,
  exigeCuitReceptor,
  desglosarIva,
  agregarIva,
  cuitValido,
  normalizarCuit,
  formatearCuit,
  numeroComprobante,
  caeVigente,
  tieneCae,
} from '@/lib/domain/facturacion'

describe('letra del comprobante', () => {
  it('entre responsables inscriptos es A', () => {
    expect(tipoComprobante('responsable_inscripto', 'responsable_inscripto')).toBe('A')
  })

  it('de responsable inscripto a consumidor final es B', () => {
    expect(tipoComprobante('responsable_inscripto', 'consumidor_final')).toBe('B')
    expect(tipoComprobante('responsable_inscripto', 'monotributo')).toBe('B')
    expect(tipoComprobante('responsable_inscripto', 'exento')).toBe('B')
  })

  it('un emisor monotributista siempre emite C', () => {
    expect(tipoComprobante('monotributo', 'responsable_inscripto')).toBe('C')
    expect(tipoComprobante('monotributo', 'consumidor_final')).toBe('C')
    expect(tipoComprobante('exento', 'responsable_inscripto')).toBe('C')
  })

  it('solo la A discrimina el IVA y exige CUIT', () => {
    expect(discriminaIva('A')).toBe(true)
    expect(discriminaIva('B')).toBe(false)
    expect(discriminaIva('C')).toBe(false)
    expect(exigeCuitReceptor('A')).toBe(true)
    expect(exigeCuitReceptor('B')).toBe(false)
  })
})

describe('desglose de IVA', () => {
  it('separa un importe con IVA al 21 %', () => {
    // 121 con IVA incluido = 100 de neto + 21 de impuesto.
    expect(desglosarIva(121, 21)).toEqual({ neto: 100, iva: 21, total: 121, alicuota: 21 })
  })

  it('neto + iva siempre da exactamente el total', () => {
    for (const importe of [642.51, 1000, 333.33, 0.01, 99.99, 12345.67]) {
      const d = desglosarIva(importe, 21)
      expect(d.neto + d.iva).toBeCloseTo(d.total, 2)
      expect(d.total).toBe(Math.round(importe * 100) / 100)
    }
  })

  it('con alícuota cero el neto es el total', () => {
    expect(desglosarIva(500, 0)).toEqual({ neto: 500, iva: 0, total: 500, alicuota: 0 })
  })

  it('soporta la alícuota reducida del 10,5 %', () => {
    const d = desglosarIva(110.5, 10.5)
    expect(d.neto).toBe(100)
    expect(d.iva).toBe(10.5)
  })

  it('agregarIva es la operación inversa', () => {
    const d = agregarIva(100, 21)
    expect(d).toEqual({ neto: 100, iva: 21, total: 121, alicuota: 21 })
    expect(desglosarIva(d.total, 21).neto).toBe(100)
  })
})

describe('validación de CUIT', () => {
  it('acepta CUIT válidos con y sin guiones', () => {
    // El dígito verificador de 30-71234567 es 1 (módulo 11).
    expect(cuitValido('30-71234567-1')).toBe(true)
    expect(cuitValido('30712345671')).toBe(true)
    expect(cuitValido('20-12345678-6')).toBe(true)
  })

  it('rechaza un dígito verificador incorrecto', () => {
    expect(cuitValido('30-71234567-8')).toBe(false)
    expect(cuitValido('30-71234567-0')).toBe(false)
  })

  it('rechaza longitudes distintas de 11', () => {
    expect(cuitValido('3071234567')).toBe(false)
    expect(cuitValido('')).toBe(false)
    expect(cuitValido('307123456789')).toBe(false)
  })

  it('normaliza y formatea', () => {
    expect(normalizarCuit('30-71234567-1')).toBe('30712345671')
    expect(formatearCuit('30712345671')).toBe('30-71234567-1')
  })

  it('deja intacto lo que no puede formatear', () => {
    expect(formatearCuit('123')).toBe('123')
  })
})

describe('numeración y CAE', () => {
  it('arma el número oficial con ceros a la izquierda', () => {
    expect(numeroComprobante(1, 123)).toBe('0001-00000123')
    expect(numeroComprobante(12, 98765432)).toBe('0012-98765432')
  })

  it('el CAE vence', () => {
    expect(caeVigente('2026-08-10', '2026-08-02')).toBe(true)
    expect(caeVigente('2026-08-02', '2026-08-02')).toBe(true) // el día del vto todavía vale
    expect(caeVigente('2026-08-01', '2026-08-02')).toBe(false)
    expect(caeVigente(null, '2026-08-02')).toBe(false)
  })

  it('una factura sin CAE no está fiscalmente completa', () => {
    expect(tieneCae({ cae: '75123456789012', cae_vto: '2026-08-20' })).toBe(true)
    expect(tieneCae({ cae: null, cae_vto: '2026-08-20' })).toBe(false)
    expect(tieneCae({})).toBe(false)
  })
})
