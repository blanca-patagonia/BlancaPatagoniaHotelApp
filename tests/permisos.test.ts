import { describe, it, expect } from 'vitest'
import { AREAS, puedeAcceder, areasDe } from '@/lib/domain/permisos'
import { ROLES } from '@/lib/domain/roles'

describe('permisos por rol', () => {
  it('admin accede a todas las áreas', () => {
    for (const area of AREAS) expect(puedeAcceder('admin', area)).toBe(true)
  })

  it('housekeeping solo ve inicio y housekeeping', () => {
    expect(areasDe('housekeeping')).toEqual(['dashboard', 'housekeeping'])
    expect(puedeAcceder('housekeeping', 'reservas')).toBe(false)
    expect(puedeAcceder('housekeeping', 'usuarios')).toBe(false)
  })

  it('recepción gestiona reservas pero no usuarios ni configuración', () => {
    expect(puedeAcceder('recepcion', 'reservas')).toBe(true)
    expect(puedeAcceder('recepcion', 'ocupacion')).toBe(true)
    expect(puedeAcceder('recepcion', 'usuarios')).toBe(false)
    expect(puedeAcceder('recepcion', 'config')).toBe(false)
  })

  it('solo admin accede a la gestión de usuarios', () => {
    for (const rol of ROLES) {
      expect(puedeAcceder(rol, 'usuarios')).toBe(rol === 'admin')
    }
  })
})
