import { describe, it, expect } from 'vitest'
import {
  filasLibroVentas,
  totalesLibroVentas,
  type FacturaLibro,
  type NotaCreditoLibro,
} from '@/lib/domain/libro-ventas'

const reserva = { codigo: 'BP-0001', huesped: { nombre: 'Ana', apellido: 'Pérez' } }

function factura(parcial: Partial<FacturaLibro> = {}): FacturaLibro {
  return {
    numero: 'FAC-1',
    numero_fiscal: '00003-00000012',
    tipo_comprobante: 'B',
    punto_venta: 3,
    emitida_en: '2026-09-10T15:00:00Z',
    neto: 100,
    iva: 21,
    exento: 0,
    alicuota_iva: 21,
    total: 121,
    moneda: 'USD',
    cae: '12345678901234',
    cae_vto: '2026-09-20',
    cuit_receptor: null,
    condicion_iva_receptor: 'consumidor_final',
    motivo_exencion: null,
    reserva,
    ...parcial,
  }
}

function nota(parcial: Partial<NotaCreditoLibro> = {}): NotaCreditoLibro {
  return {
    numero: 'NC-1',
    numero_fiscal: '00003-00000002',
    tipo_comprobante: 'B',
    punto_venta: 3,
    emitida_en: '2026-09-12T15:00:00Z',
    neto: 50,
    iva: 10.5,
    exento: 0,
    alicuota_iva: 21,
    total: 60.5,
    moneda: 'USD',
    cae: null,
    cae_vto: null,
    motivo: 'Una noche no se usó',
    factura: {
      numero: 'FAC-1',
      numero_fiscal: '00003-00000012',
      cuit_receptor: null,
      condicion_iva_receptor: 'consumidor_final',
      reserva,
    },
    ...parcial,
  }
}

describe('libro de ventas', () => {
  it('una nota de crédito resta: el total del período es lo vendido de verdad', () => {
    const filas = filasLibroVentas([factura()], [nota()])
    expect(filas.map((f) => f.comprobante)).toEqual(['Factura', 'Nota de crédito'])
    expect(filas[1].total).toBe(-60.5)
    expect(filas[1].iva).toBe(-10.5)
    expect(totalesLibroVentas(filas)).toEqual({ netoGravado: 50, exento: 0, iva: 10.5, total: 60.5 })
  })

  it('la nota de crédito lleva el cliente y la factura que corrige', () => {
    const [, nc] = filasLibroVentas([factura()], [nota()])
    expect(nc.cliente).toBe('Pérez, Ana')
    expect(nc.reserva).toBe('BP-0001')
    expect(nc.referencia).toBe('00003-00000012')
    expect(nc.observaciones).toBe('Una noche no se usó')
  })

  it('parte el neto en gravado y exento: gravado + exento + IVA = total', () => {
    // Turista del exterior (ADR 0024): el alojamiento es exento y sólo lo demás lleva IVA.
    const [f] = filasLibroVentas(
      [factura({ neto: 300, exento: 200, iva: 21, total: 321, motivo_exencion: 'Turista extranjero' })],
      [],
    )
    expect(f.netoGravado).toBe(100)
    expect(f.exento).toBe(200)
    expect((f.netoGravado ?? 0) + f.exento + (f.iva ?? 0)).toBe(f.total)
    expect(f.observaciones).toContain('Turista extranjero')
  })

  it('usa la fecha del hotel: lo emitido a las 22:00 del 30 cae en ese mes', () => {
    // 01:00 UTC del 1/10 son las 22:00 del 30/9 en El Calafate.
    const [f] = filasLibroVentas([factura({ emitida_en: '2026-10-01T01:00:00Z' })], [])
    expect(f.fecha).toBe('2026-09-30')
  })

  it('ordena por momento de emisión', () => {
    const filas = filasLibroVentas(
      [factura({ numero: 'B', numero_fiscal: null, emitida_en: '2026-09-15T12:00:00Z' })],
      [nota({ emitida_en: '2026-09-01T12:00:00Z' })],
    )
    expect(filas.map((f) => f.numero)).toEqual(['00003-00000002', 'B'])
  })

  it('sin desglose fiscal (comprobantes viejos) deja el neto vacío, no en cero', () => {
    const [f] = filasLibroVentas([factura({ neto: null, iva: null })], [])
    expect(f.netoGravado).toBeNull()
    expect(f.iva).toBeNull()
    expect(f.total).toBe(121)
  })

  it('formatea el CUIT y traduce la condición frente al IVA', () => {
    const [f] = filasLibroVentas(
      [factura({ cuit_receptor: '30712345678', condicion_iva_receptor: 'responsable_inscripto' })],
      [],
    )
    expect(f.cuit).toBe('30-71234567-8')
    expect(f.condicionIva).toBe('Responsable Inscripto')
    expect(f.puntoVenta).toBe('00003')
  })
})
