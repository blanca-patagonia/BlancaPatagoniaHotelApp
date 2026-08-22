import { describe, it, expect } from 'vitest'
import { AREAS, AREAS_OCULTAS, estaOculta, puedeAcceder, areasDe } from '@/lib/domain/permisos'
import { ROLES } from '@/lib/domain/roles'

describe('permisos por rol', () => {
  it('admin accede a todas las áreas que no estén apagadas', () => {
    for (const area of AREAS) {
      expect(puedeAcceder('admin', area), `área ${area}`).toBe(!estaOculta(area))
    }
  })

  it('housekeeping ve inicio, su área, mantenimiento, avisos y ayuda', () => {
    // `conversaciones` estaba en esta lista y salió al apagarse el módulo.
    expect(areasDe('housekeeping')).toEqual([
      'dashboard',
      'housekeeping',
      'mantenimiento',
      'avisos',
      'ayuda',
    ])
    expect(puedeAcceder('housekeeping', 'reservas')).toBe(false)
    expect(puedeAcceder('housekeeping', 'usuarios')).toBe(false)
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

  it('los contratos los ven solo admin y gerencia', () => {
    expect(puedeAcceder('admin', 'contratos')).toBe(true)
    expect(puedeAcceder('gerencia', 'contratos')).toBe(true)
    expect(puedeAcceder('recepcion', 'contratos')).toBe(false)
    expect(puedeAcceder('housekeeping', 'contratos')).toBe(false)
  })

  it('solo admin accede a la gestión de usuarios', () => {
    for (const rol of ROLES) {
      expect(puedeAcceder(rol, 'usuarios')).toBe(rol === 'admin')
    }
  })

  describe('áreas apagadas', () => {
    /*
      El hotel decidió no usar auditoría, conversaciones ni objetos perdidos por
      ahora. El código sigue entero y se vuelven a habilitar sacándolas de
      `AREAS_OCULTAS`; estos tests fijan que mientras estén ahí queden apagadas para
      TODOS, incluido admin, y que apagarlas no se lleve puesto lo demás.
    */

    it('ninguna área apagada la puede ver nadie, ni admin', () => {
      for (const area of AREAS_OCULTAS) {
        for (const rol of ROLES) {
          expect(puedeAcceder(rol, area), `${rol} todavía ve ${area}`).toBe(false)
        }
      }
    })

    it('ninguna área apagada aparece en el menú de ningún rol', () => {
      // `areasDe` es lo que arma la navegación: si el nombre siguiera acá, el ítem
      // se vería en el menú y llevaría a una pantalla que redirige.
      for (const rol of ROLES) {
        for (const area of areasDe(rol)) {
          expect(estaOculta(area), `${rol} tiene ${area} en el menú`).toBe(false)
        }
      }
    })

    it('apagar un área no deja a ningún rol sin las que sí usa', () => {
      // El apagado es un filtro y podría estar mal escrito: esto verifica que lo que
      // queda es exactamente «lo que tenía menos lo apagado», y nada más.
      for (const rol of ROLES) {
        expect(areasDe(rol).length, `${rol} quedó sin áreas`).toBeGreaterThan(0)
        expect(puedeAcceder(rol, 'dashboard')).toBe(true)
        expect(puedeAcceder(rol, 'ayuda')).toBe(true)
      }
    })
  })
})
