import { describe, it, expect } from 'vitest'
import { nombreCompleto } from '@/lib/domain/huespedes'

/**
 * Auditoría QA/UX 2026-10-14: la reserva rápida de mostrador solo pide el
 * apellido y completa `nombre` con el mismo valor (columna `not null`).
 * Mostrarlo tal cual («ZZZ-Promo, ZZZ-Promo») se lee como un bug.
 */
describe('nombreCompleto', () => {
  it('muestra apellido y nombre cuando son distintos', () => {
    expect(nombreCompleto({ apellido: 'Gómez', nombre: 'Ana' })).toBe('Gómez, Ana')
  })

  it('colapsa a un solo valor cuando nombre quedó igual al apellido', () => {
    expect(nombreCompleto({ apellido: 'ZZZ-QA-Promo', nombre: 'ZZZ-QA-Promo' })).toBe('ZZZ-QA-Promo')
  })

  it('colapsa sin distinguir mayúsculas/minúsculas', () => {
    expect(nombreCompleto({ apellido: 'Pérez', nombre: 'pérez' })).toBe('Pérez')
  })

  it('colapsa cuando nombre viene vacío o ausente', () => {
    expect(nombreCompleto({ apellido: 'Díaz', nombre: '' })).toBe('Díaz')
    expect(nombreCompleto({ apellido: 'Díaz' })).toBe('Díaz')
  })

  it('ignora espacios al comparar', () => {
    expect(nombreCompleto({ apellido: ' Ruiz ', nombre: ' Ruiz ' })).toBe('Ruiz')
  })
})
