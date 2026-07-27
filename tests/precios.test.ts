import { describe, it, expect } from 'vitest'
import {
  calcularEstadia,
  precioPorNoche,
  promocionAplica,
  type NocheTarifada,
  type Promocion,
} from '@/lib/domain/precios'

const rackSingleBaja = { precioNeto: 85, precioRack: 120, ivaPct: 21 }

function noches(cantidad: number, precio: number, ivaPct = 21): NocheTarifada[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    fecha: `2025-09-${String(i + 1).padStart(2, '0')}`,
    precio,
    ivaPct,
  }))
}

describe('precioPorNoche', () => {
  it('usa el precio rack para el canal mostrador', () => {
    expect(precioPorNoche(rackSingleBaja, 'rack')).toBe(120)
  })
  it('usa el precio neto para el canal agencia', () => {
    expect(precioPorNoche(rackSingleBaja, 'neto')).toBe(85)
  })
})

describe('calcularEstadia', () => {
  it('suma noches y aplica IVA 21% sobre el neto', () => {
    const r = calcularEstadia({ noches: noches(3, 120) })
    expect(r.noches).toBe(3)
    expect(r.subtotalNeto).toBe(360)
    expect(r.descuento).toBe(0)
    expect(r.totalNeto).toBe(360)
    expect(r.iva).toBe(75.6)
    expect(r.total).toBe(435.6)
  })

  it('aplica una promoción por porcentaje si cumple el mínimo de noches', () => {
    const promo: Promocion = { tipo: 'porcentaje', valor: 10, condiciones: { min_noches: 5 } }
    const r = calcularEstadia({ noches: noches(5, 120), promocion: promo })
    expect(r.subtotalNeto).toBe(600)
    expect(r.descuento).toBe(60)
    expect(r.totalNeto).toBe(540)
    expect(r.iva).toBe(113.4)
    expect(r.total).toBe(653.4)
  })

  it('no aplica la promoción si no cumple las condiciones', () => {
    const promo: Promocion = { tipo: 'porcentaje', valor: 10, condiciones: { min_noches: 5 } }
    const r = calcularEstadia({ noches: noches(4, 120), promocion: promo })
    expect(r.descuento).toBe(0)
    expect(r.total).toBe(480 * 1.21)
  })

  it('un descuento por monto no supera el subtotal', () => {
    const promo: Promocion = { tipo: 'monto', valor: 1000 }
    const r = calcularEstadia({ noches: noches(1, 120), promocion: promo })
    expect(r.descuento).toBe(120)
    expect(r.totalNeto).toBe(0)
    expect(r.total).toBe(0)
  })

  it('las promociones de tipo paquete no ajustan el precio del alojamiento', () => {
    const promo: Promocion = { tipo: 'paquete', valor: 50 }
    const r = calcularEstadia({ noches: noches(2, 120), promocion: promo })
    expect(r.descuento).toBe(0)
  })
})

describe('promocionAplica', () => {
  it('valida el mínimo de noches y la anticipación', () => {
    const promo: Promocion = {
      tipo: 'porcentaje',
      valor: 15,
      condiciones: { anticipacion_dias: 60 },
    }
    expect(promocionAplica(promo, 2, 70)).toBe(true)
    expect(promocionAplica(promo, 2, 30)).toBe(false)
  })
})
