import { describe, it, expect } from 'vitest'
import {
  subtotalConsumo,
  totalConsumos,
  cuentaConsolidada,
  type Consumo,
} from '@/lib/domain/consumos'

const consumos: Consumo[] = [
  { cantidad: 2, precioUnitario: 7 }, // 2 cervezas = 14
  { cantidad: 1, precioUnitario: 90 }, // excursión = 90
]

describe('consumos', () => {
  it('calcula el subtotal de un consumo', () => {
    expect(subtotalConsumo({ cantidad: 3, precioUnitario: 4 })).toBe(12)
  })

  it('suma el total de consumos', () => {
    expect(totalConsumos(consumos)).toBe(104)
  })

  it('consolida alojamiento + consumos', () => {
    const cuenta = cuentaConsolidada(642.51, consumos)
    expect(cuenta.alojamiento).toBe(642.51)
    expect(cuenta.consumos).toBe(104)
    expect(cuenta.total).toBe(746.51)
  })

  it('una reserva sin consumos tiene cuenta = alojamiento', () => {
    const cuenta = cuentaConsolidada(500, [])
    expect(cuenta.consumos).toBe(0)
    expect(cuenta.total).toBe(500)
  })
})
