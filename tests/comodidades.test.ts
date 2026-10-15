import { describe, it, expect } from 'vitest'
import { claveDeComodidad } from '@/lib/domain/comodidades'

describe('claveDeComodidad', () => {
  it('reconoce las comodidades cargadas en el catálogo', () => {
    expect(claveDeComodidad('Vista al Lago Argentino')).toBe('vista')
    expect(claveDeComodidad('Hidromasaje')).toBe('hidromasaje')
    expect(claveDeComodidad('Desayuno buffet')).toBe('desayuno')
    expect(claveDeComodidad('WiFi')).toBe('wifi')
    expect(claveDeComodidad('Hogar a parrilla')).toBe('hogar')
    expect(claveDeComodidad('Cocina equipada')).toBe('cocina')
  })

  it('tolera variantes de escritura: tildes, mayúsculas y guiones', () => {
    expect(claveDeComodidad('Wi-Fi gratis')).toBe('wifi')
    expect(claveDeComodidad('CALEFACCIÓN central')).toBe('calefaccion')
    expect(claveDeComodidad('Bañera de hidromasaje')).toBe('hidromasaje')
  })

  it('devuelve null para lo desconocido, que la pantalla muestra tal cual', () => {
    expect(claveDeComodidad('Secador de pelo')).toBeNull()
  })
})
