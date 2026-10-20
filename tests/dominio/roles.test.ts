import { describe, it, expect } from 'vitest'
import { ROLES, esRolValido, ETIQUETAS_ROL } from '@/lib/domain/roles'

describe('roles del sistema', () => {
  it('reconoce roles válidos', () => {
    expect(esRolValido('admin')).toBe(true)
    expect(esRolValido('recepcion')).toBe(true)
  })

  it('rechaza valores que no son roles', () => {
    expect(esRolValido('superusuario')).toBe(false)
    expect(esRolValido('')).toBe(false)
  })

  it('define una etiqueta legible para cada rol', () => {
    for (const rol of ROLES) {
      expect(ETIQUETAS_ROL[rol]).toBeTruthy()
    }
  })
})
