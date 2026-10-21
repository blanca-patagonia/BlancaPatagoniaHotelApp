import { describe, it, expect } from 'vitest'
import { alternarGrupo, estaPlegado, leerPlegadosGuardado } from '@/lib/domain/nav-plegado'

describe('plegado de los grupos del menú', () => {
  it('un grupo nuevo empieza abierto', () => {
    expect(estaPlegado([], 'Comercial')).toBe(false)
  })

  it('alternar lo pliega y alternar de nuevo lo despliega', () => {
    const plegado = alternarGrupo([], 'Comercial')
    expect(estaPlegado(plegado, 'Comercial')).toBe(true)

    const desplegado = alternarGrupo(plegado, 'Comercial')
    expect(estaPlegado(desplegado, 'Comercial')).toBe(false)
  })

  it('plegar un grupo no afecta a los demás', () => {
    const plegado = alternarGrupo(['Equipo'], 'Comercial')
    expect(estaPlegado(plegado, 'Equipo')).toBe(true)
    expect(estaPlegado(plegado, 'Comercial')).toBe(true)
    expect(estaPlegado(plegado, 'Operación')).toBe(false)
  })

  it('no duplica el título si ya estaba plegado', () => {
    const plegado = alternarGrupo(['Comercial'], 'Comercial')
    expect(plegado.filter((t) => t === 'Comercial')).toHaveLength(0)
  })

  describe('leerPlegadosGuardado', () => {
    it('sin nada guardado, todo abierto', () => {
      expect(leerPlegadosGuardado(null)).toEqual([])
      expect(leerPlegadosGuardado('')).toEqual([])
      expect(leerPlegadosGuardado('   ')).toEqual([])
    })

    it('interpreta un arreglo guardado', () => {
      expect(leerPlegadosGuardado('["Comercial","Equipo"]')).toEqual(['Comercial', 'Equipo'])
    })

    it('algo corrupto o de otra forma vuelve a todo abierto, no rompe', () => {
      expect(leerPlegadosGuardado('{no es json')).toEqual([])
      expect(leerPlegadosGuardado('"un string suelto"')).toEqual([])
      expect(leerPlegadosGuardado('42')).toEqual([])
      expect(leerPlegadosGuardado('[1, 2, "Comercial"]')).toEqual(['Comercial'])
    })
  })
})
