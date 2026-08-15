import { describe, it, expect } from 'vitest'
import { agruparAreas, areasSinGrupo, AREAS_AGRUPADAS, GRUPOS } from '@/lib/domain/navegacion'
import { AREAS, areasDe } from '@/lib/domain/permisos'
import { ROLES } from '@/lib/domain/roles'

describe('cobertura de la agrupación', () => {
  it('no deja ningún área fuera del menú', () => {
    // Esta es la guarda que importa: si alguien agrega un área a `permisos.ts`
    // y se olvida de ubicarla en un grupo, el área desaparecería del menú sin
    // que nada falle. El test la nombra.
    expect(areasSinGrupo()).toEqual([])
  })

  it('no repite un área en dos grupos', () => {
    expect(new Set(AREAS_AGRUPADAS).size).toBe(AREAS_AGRUPADAS.length)
  })

  it('no inventa áreas que no existan en permisos', () => {
    for (const area of AREAS_AGRUPADAS) {
      expect(AREAS).toContain(area)
    }
  })
})

describe('agruparAreas', () => {
  it('descarta los grupos que quedan sin áreas visibles', () => {
    // Housekeeping ve pocas áreas: no puede terminar con encabezados vacíos.
    const grupos = agruparAreas(areasDe('housekeeping'))
    expect(grupos.length).toBeGreaterThan(0)
    for (const g of grupos) expect(g.areas.length).toBeGreaterThan(0)
  })

  it('solo muestra áreas que el rol puede ver', () => {
    const visibles = areasDe('housekeeping')
    for (const g of agruparAreas(visibles)) {
      for (const a of g.areas) expect(visibles).toContain(a)
    }
  })

  it('mantiene el orden declarado y no el del rol', () => {
    // El menú no puede cambiar de forma segun quién entre: se ordena por
    // `GRUPOS`, no por el orden en que venga la lista de áreas visibles.
    const alReves = [...areasDe('admin')].reverse()
    const grupos = agruparAreas(alReves)
    expect(grupos[0].titulo).toBe(GRUPOS[0].titulo)
    expect(grupos[0].areas[0]).toBe('dashboard')
  })

  it('para el admin conserva todas sus áreas', () => {
    const visibles = areasDe('admin')
    const enGrupos = agruparAreas(visibles).flatMap((g) => g.areas)
    expect(new Set(enGrupos)).toEqual(new Set(visibles))
  })

  it('ningún rol pierde áreas al agruparse', () => {
    for (const rol of ROLES) {
      const visibles = areasDe(rol)
      const enGrupos = agruparAreas(visibles).flatMap((g) => g.areas)
      expect(new Set(enGrupos)).toEqual(new Set(visibles))
    }
  })
})
