import { describe, it, expect } from 'vitest'
import {
  ETAPAS_COMERCIALES,
  TRANSICIONES_ETAPA,
  puedeAvanzar,
  etapasPosibles,
  esGanada,
  esPerdida,
  progresoPct,
  conteoPorEtapa,
  tasaConversion,
} from '@/lib/domain/comercial'

describe('embudo comercial', () => {
  it('define transiciones para todas las etapas', () => {
    for (const e of ETAPAS_COMERCIALES) expect(TRANSICIONES_ETAPA[e]).toBeDefined()
  })

  it('avanza etapa por etapa', () => {
    expect(puedeAvanzar('contacto', 'cotizacion_enviada')).toBe(true)
    expect(puedeAvanzar('cotizacion_enviada', 'convenio_firmado')).toBe(true)
    expect(puedeAvanzar('convenio_firmado', 'activa')).toBe(true)
  })

  it('no permite saltearse etapas', () => {
    expect(puedeAvanzar('contacto', 'activa')).toBe(false)
    expect(puedeAvanzar('contacto', 'convenio_firmado')).toBe(false)
  })

  it('desde cualquier etapa se puede perder la oportunidad', () => {
    for (const e of ['contacto', 'cotizacion_enviada', 'convenio_firmado', 'activa'] as const) {
      expect(etapasPosibles(e)).toContain('perdida')
    }
  })

  it('una oportunidad perdida se puede reabrir', () => {
    expect(puedeAvanzar('perdida', 'contacto')).toBe(true)
    expect(puedeAvanzar('perdida', 'activa')).toBe(false)
  })
})

describe('progreso', () => {
  it('crece a lo largo del embudo', () => {
    expect(progresoPct('contacto')).toBe(25)
    expect(progresoPct('cotizacion_enviada')).toBe(50)
    expect(progresoPct('convenio_firmado')).toBe(75)
    expect(progresoPct('activa')).toBe(100)
  })

  it('una oportunidad perdida no aporta al pronóstico', () => {
    expect(progresoPct('perdida')).toBe(0)
  })

  it('distingue ganada de perdida', () => {
    expect(esGanada('activa')).toBe(true)
    expect(esGanada('convenio_firmado')).toBe(false)
    expect(esPerdida('perdida')).toBe(true)
  })
})

describe('tablero del embudo', () => {
  const agencias = [
    { etapa: 'contacto' as const },
    { etapa: 'contacto' as const },
    { etapa: 'activa' as const },
    { etapa: 'perdida' as const },
  ]

  it('cuenta por etapa incluyendo las vacías', () => {
    const c = conteoPorEtapa(agencias)
    expect(c.contacto).toBe(2)
    expect(c.activa).toBe(1)
    expect(c.perdida).toBe(1)
    expect(c.cotizacion_enviada).toBe(0)
  })

  it('la conversión mira solo las cerradas', () => {
    // 1 ganada y 1 perdida => 50 %. Las dos en contacto no se cuentan.
    expect(tasaConversion(agencias)).toBe(50)
  })

  it('sin oportunidades cerradas no hay tasa', () => {
    expect(tasaConversion([{ etapa: 'contacto' }])).toBeNull()
    expect(tasaConversion([])).toBeNull()
  })
})
