import { describe, it, expect } from 'vitest'
import { esRolValido, ROLES } from '@/lib/domain/roles'
import { puedeAcceder } from '@/lib/domain/permisos'

/**
 * La migración 0032 hace que un alta que no pase por `app/panel/usuarios` nazca
 * con `rol = 'sin_rol'` y `activo = false`.
 *
 * Del lado del código, la barrera es que `sin_rol` NO figure en `ROLES`: así
 * `esRolValido` devuelve `false` y `obtenerSesion` (lib/auth/session.ts:32)
 * descarta la sesión. Es una defensa que funciona por AUSENCIA, y por eso hace
 * falta un test: si alguien agrega `sin_rol` a `ROLES` «para que la base y el
 * código coincidan», reabre el agujero sin que nada se queje.
 */

describe('alta de usuario sin privilegios (migración 0032)', () => {
  it('sin_rol no es un rol válido del sistema', () => {
    expect(esRolValido('sin_rol')).toBe(false)
  })

  it('sin_rol no figura en ROLES, que es lo que hace que la sesión se rechace', () => {
    expect(ROLES).not.toContain('sin_rol')
  })

  it('los cuatro roles operativos siguen siendo válidos', () => {
    for (const rol of ['admin', 'gerencia', 'recepcion', 'housekeeping']) {
      expect(esRolValido(rol)).toBe(true)
    }
  })

  it('un valor arbitrario tampoco pasa', () => {
    expect(esRolValido('superadmin')).toBe(false)
    expect(esRolValido('')).toBe(false)
  })
})

describe('huéspedes exige rol, no solo sesión', () => {
  /**
   * `app/panel/huespedes/actions.ts` definía un guard propio que solo comprobaba
   * que existiera sesión. Ahora usa `requerirAcceso('huespedes')`, que consulta
   * esta matriz. Housekeeping trabaja con habitaciones, no con los datos de
   * documento de los huéspedes.
   */
  it('housekeeping no accede a huéspedes', () => {
    expect(puedeAcceder('housekeeping', 'huespedes')).toBe(false)
  })

  it('recepción, gerencia y admin sí', () => {
    expect(puedeAcceder('recepcion', 'huespedes')).toBe(true)
    expect(puedeAcceder('gerencia', 'huespedes')).toBe(true)
    expect(puedeAcceder('admin', 'huespedes')).toBe(true)
  })
})
