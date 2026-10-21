import { describe, it, expect } from 'vitest'
import { importe, formatearUSD, porNoche } from '@/lib/domain/moneda'

describe('importe', () => {
  it('siempre lleva dos decimales', () => {
    // El caso que motivó el módulo: la tarifa base de 120 más el 21 % de IVA
    // daba 145.2, y `toLocaleString` lo publicaba como «145,2».
    expect(importe(145.2)).toBe('145,20')
    expect(importe(120)).toBe('120,00')
    expect(importe(168.19)).toBe('168,19')
  })

  it('usa el punto como separador de miles, en formato argentino', () => {
    expect(importe(1234.5)).toBe('1.234,50')
  })

  it('no propaga NaN a la pantalla del huésped', () => {
    // `Number(null)` y `Number(undefined)` aparecen al leer columnas nulas.
    expect(importe(Number('no es un número'))).toBe('0,00')
    expect(importe(Number(undefined))).toBe('0,00')
  })
})

describe('formatearUSD', () => {
  it('antepone la moneda', () => {
    expect(formatearUSD(145.2)).toBe('USD 145,20')
  })
})

describe('porNoche', () => {
  it('reparte el total entre las noches', () => {
    expect(porNoche(435.6, 3)).toBe(145.2)
  })

  it('redondea a dos decimales, como el motor de precios', () => {
    expect(porNoche(100, 3)).toBe(33.33)
  })

  it('devuelve cero en vez de dividir por cero', () => {
    expect(porNoche(500, 0)).toBe(0)
    expect(porNoche(500, -2)).toBe(0)
  })
})
