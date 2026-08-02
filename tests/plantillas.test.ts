import { describe, it, expect } from 'vitest'
import {
  EVENTOS_EMAIL,
  PLANTILLAS,
  renderizar,
  variablesFaltantes,
} from '@/lib/domain/plantillas'

describe('catálogo de plantillas', () => {
  it('hay una plantilla por evento', () => {
    for (const e of EVENTOS_EMAIL) {
      expect(PLANTILLAS[e]).toBeDefined()
      expect(PLANTILLAS[e].evento).toBe(e)
    }
  })

  it('cada plantilla declara asunto, cuerpo y disparador', () => {
    for (const e of EVENTOS_EMAIL) {
      const p = PLANTILLAS[e]
      expect(p.asunto.length).toBeGreaterThan(0)
      expect(p.cuerpo.length).toBeGreaterThan(0)
      expect(p.disparador.length).toBeGreaterThan(0)
    }
  })

  it('las variables declaradas son las que usa el texto', () => {
    for (const e of EVENTOS_EMAIL) {
      const p = PLANTILLAS[e]
      const usadas = new Set(
        [...`${p.asunto} ${p.cuerpo}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]),
      )
      // Toda variable usada tiene que estar declarada, y viceversa.
      expect([...usadas].sort()).toEqual([...p.variables].sort())
    }
  })
})

describe('render', () => {
  const datos = {
    nombre: 'Ana',
    codigo: 'BP-0042',
    check_in: '10/09/2026',
    check_out: '13/09/2026',
    hora_check_in: '15:00',
    hora_check_out: '10:00',
    total: '642,51',
    enlace: 'https://blancapatagonia.com/r/abc',
  }

  it('reemplaza los marcadores en asunto y cuerpo', () => {
    const r = renderizar('confirmacion_reserva', datos)
    expect(r.asunto).toBe('Tu reserva en Blanca Patagonia está confirmada (BP-0042)')
    expect(r.cuerpo).toContain('Hola Ana,')
    expect(r.cuerpo).toContain('USD 642,51')
    expect(r.faltantes).toEqual([])
  })

  it('no deja marcadores sin reemplazar cuando están todos los datos', () => {
    const r = renderizar('confirmacion_reserva', datos)
    expect(r.cuerpo).not.toMatch(/\{\{\w+\}\}/)
  })

  it('deja el marcador VISIBLE cuando falta el dato', () => {
    // Es preferible que el error salte antes de enviar y no que llegue «Hola ,».
    const r = renderizar('recordatorio_checkin', { codigo: 'BP-1', check_in: '10/09' })
    expect(r.cuerpo).toContain('{{nombre}}')
    expect(r.faltantes).toContain('nombre')
    expect(r.faltantes).toContain('hora_check_in')
  })

  it('acepta números además de texto', () => {
    const r = renderizar('cambio_nivel_fidelidad', { nombre: 'Ana', nivel: 'Oro', puntos: 2100 })
    expect(r.cuerpo).toContain('2100 puntos')
    expect(r.faltantes).toEqual([])
  })

  it('variablesFaltantes detecta también los valores vacíos', () => {
    expect(variablesFaltantes(PLANTILLAS.encuesta_postcheckout, { nombre: '', enlace: 'x' })).toEqual([
      'nombre',
    ])
  })
})
