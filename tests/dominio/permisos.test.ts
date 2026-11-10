import { describe, it, expect } from 'vitest'
import { AREAS, puedeAcceder, areasDe } from '@/lib/domain/permisos'
import { ROLES } from '@/lib/domain/roles'

describe('permisos por rol', () => {
  it('admin accede a todas las áreas', () => {
    for (const area of AREAS) {
      expect(puedeAcceder('admin', area), `área ${area}`).toBe(true)
    }
  })

  it('housekeeping ve inicio, su área y ayuda', () => {
    expect(areasDe('housekeeping')).toEqual([
      'dashboard',
      'housekeeping',
      'ayuda',
    ])
    expect(puedeAcceder('housekeeping', 'reservas')).toBe(false)
    expect(puedeAcceder('housekeeping', 'usuarios')).toBe(false)
    expect(puedeAcceder('housekeeping', 'reportes')).toBe(false)
  })

  it('la ayuda la ven todos los roles', () => {
    // Quien más necesita el manual es justamente quien menos permisos tiene.
    for (const rol of ROLES) expect(puedeAcceder(rol, 'ayuda')).toBe(true)
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

  it('ningún rol queda sin inicio ni ayuda', () => {
    for (const rol of ROLES) {
      expect(areasDe(rol).length, `${rol} quedó sin áreas`).toBeGreaterThan(0)
      expect(puedeAcceder(rol, 'dashboard')).toBe(true)
      expect(puedeAcceder(rol, 'ayuda')).toBe(true)
    }
  })

  it('la auditoría es sólo del administrador', () => {
    for (const rol of ROLES) {
      expect(puedeAcceder(rol, 'auditoria'), rol).toBe(rol === 'admin')
    }
  })
})

describe('esDireccion', () => {
  it('sólo admin y gerencia', async () => {
    const { esDireccion } = await import('@/lib/domain/permisos')
    expect(esDireccion('admin')).toBe(true)
    expect(esDireccion('gerencia')).toBe(true)
    expect(esDireccion('recepcion')).toBe(false)
    expect(esDireccion('housekeeping')).toBe(false)
    expect(esDireccion(undefined)).toBe(false)
  })
})
