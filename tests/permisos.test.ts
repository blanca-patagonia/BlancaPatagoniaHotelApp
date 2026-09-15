import { describe, it, expect } from 'vitest'
import { AREAS, AREAS_OCULTAS, PERMISOS, estaOculta, puedeAcceder, areasDe } from '@/lib/domain/permisos'
import { ROLES } from '@/lib/domain/roles'

describe('permisos por rol', () => {
  it('admin accede a todas las áreas que no estén apagadas', () => {
    for (const area of AREAS) {
      expect(puedeAcceder('admin', area), `área ${area}`).toBe(!estaOculta(area))
    }
  })

  it('housekeeping ve inicio, su área, mantenimiento, avisos y ayuda', () => {
    // `conversaciones` está en esta lista pero salió por estar en
    // `AREAS_OCULTAS` (ver el test de «áreas apagadas» más abajo).
    expect(areasDe('housekeeping')).toEqual([
      'dashboard',
      'housekeeping',
      'mantenimiento',
      'avisos',
      'ayuda',
    ])
    expect(puedeAcceder('housekeeping', 'reservas')).toBe(false)
    expect(puedeAcceder('housekeeping', 'usuarios')).toBe(false)
    // El asistente de IA queda para admin y gerencia: contesta con datos de
    // plata, y housekeeping no entra ni a reportes.
    expect(puedeAcceder('housekeeping', 'ia')).toBe(false)
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

  it('contratos está asignado solo a admin y gerencia (aunque hoy esté apagado para todos)', () => {
    // `contratos` está en `AREAS_OCULTAS` (pedido del hotel, 2026-09-14), así
    // que `puedeAcceder` da `false` para cualquier rol — eso ya lo cubre el
    // bloque de «áreas apagadas» más abajo. Esto prueba la otra mitad: a quién
    // quedaría asignada si algún día se vuelve a habilitar sacándola de esa
    // lista, sin tener que tocar `PERMISOS` para eso.
    expect(PERMISOS.admin.includes('contratos')).toBe(true)
    expect(PERMISOS.gerencia.includes('contratos')).toBe(true)
    expect(PERMISOS.recepcion.includes('contratos')).toBe(false)
    expect(PERMISOS.housekeeping.includes('contratos')).toBe(false)
  })

  it('solo admin accede a la gestión de usuarios', () => {
    for (const rol of ROLES) {
      expect(puedeAcceder(rol, 'usuarios')).toBe(rol === 'admin')
    }
  })

  describe('áreas apagadas', () => {
    /*
      El hotel decidió no usar auditoría, objetos perdidos ni conversaciones
      por ahora (más contratos y respaldos, ver el test de arriba). El código
      sigue entero y se vuelven a habilitar sacándolas de `AREAS_OCULTAS`;
      estos tests fijan que mientras estén ahí queden apagadas para TODOS,
      incluido admin, y que apagarlas no se lleve puesto lo demás.
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
