import { describe, it, expect } from 'vitest'
import { HERRAMIENTAS_IA, promptSistemaIA } from '@/lib/domain/ia-herramientas'

describe('catálogo de herramientas del asistente de IA', () => {
  it('cada herramienta tiene nombre y descripción', () => {
    for (const h of HERRAMIENTAS_IA) {
      expect(h.nombre.length).toBeGreaterThan(0)
      expect(h.descripcion.length).toBeGreaterThan(0)
    }
  })

  it('no repite nombres — dos herramientas con el mismo nombre confundirían al modelo', () => {
    const nombres = HERRAMIENTAS_IA.map((h) => h.nombre)
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('los nombres son válidos como identificador de función (sin tildes ni espacios)', () => {
    // Varios proveedores validan el nombre de función contra esta forma; un
    // nombre en español con tilde ("ocupación") lo rechazarían.
    for (const h of HERRAMIENTAS_IA) {
      expect(h.nombre).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('cada parámetro declarado es un objeto JSON Schema válido', () => {
    for (const h of HERRAMIENTAS_IA) {
      expect(h.parametros.type).toBe('object')
      expect(typeof h.parametros.properties).toBe('object')
    }
  })

  it('el system prompt le prohíbe inventar datos del hotel', () => {
    const prompt = promptSistemaIA()
    expect(prompt.toLowerCase()).toContain('inventes')
    expect(prompt.length).toBeGreaterThan(50)
  })
})
