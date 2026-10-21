import { describe, it, expect } from 'vitest'
import { duracionLegible, mediana, resumirInforme, type FilaInforme } from '@/lib/domain/bandeja-informes'

const fila = (p: Partial<FilaInforme>): FilaInforme => ({
  canal: 'whatsapp',
  estado: 'abierta',
  asignada_a: null,
  creado_en: '2026-10-20T10:00:00Z',
  primera_respuesta_en: null,
  resuelta_en: null,
  esperando_desde: null,
  ...p,
})

describe('mediana', () => {
  it('impar, par y vacío', () => {
    expect(mediana([3, 1, 2])).toBe(2)
    expect(mediana([1, 2, 3, 4])).toBe(2.5)
    expect(mediana([])).toBeNull()
  })
})

describe('resumirInforme', () => {
  it('la mediana no se deja arrastrar por una consulta de la noche', () => {
    // Cuatro respondidas en 5 min y una en 9 horas: el promedio diría 112 min, la mediana 5.
    const filas = [5, 5, 5, 5, 540].map((m) =>
      fila({ primera_respuesta_en: new Date(new Date('2026-10-20T10:00:00Z').getTime() + m * 60_000).toISOString() }),
    )
    expect(resumirInforme(filas).medianaPrimeraRespuesta).toBe(5)
  })

  it('cuenta estados, espera y porcentaje respondido', () => {
    const r = resumirInforme([
      fila({ estado: 'abierta', esperando_desde: '2026-10-20T10:00:00Z' }),
      fila({ estado: 'pendiente' }),
      fila({ estado: 'resuelta', primera_respuesta_en: '2026-10-20T10:10:00Z', resuelta_en: '2026-10-20T12:00:00Z' }),
      fila({ estado: 'pospuesta' }),
    ])
    expect(r).toMatchObject({ total: 4, abiertas: 2, resueltas: 1, sinResponder: 1, porcentajeRespondidas: 25, medianaPrimeraRespuesta: 10, medianaResolucion: 120 })
  })

  it('una resuelta no cuenta como «esperando» aunque conserve la fecha', () => {
    expect(resumirInforme([fila({ estado: 'resuelta', esperando_desde: '2026-10-20T10:00:00Z' })]).sinResponder).toBe(0)
  })

  it('una respuesta anterior a la creación (dato roto) no entra al cálculo', () => {
    expect(resumirInforme([fila({ primera_respuesta_en: '2026-10-20T09:00:00Z' })]).medianaPrimeraRespuesta).toBeNull()
  })

  it('agrupa por canal y por persona, de mayor a menor', () => {
    const r = resumirInforme([
      fila({ canal: 'email', asignada_a: 'a', estado: 'resuelta' }),
      fila({ canal: 'whatsapp', asignada_a: 'a' }),
      fila({ canal: 'whatsapp', asignada_a: null }),
    ])
    expect(r.porCanal.map((c) => [c.canal, c.total])).toEqual([['whatsapp', 2], ['email', 1]])
    expect(r.porAgente).toEqual([
      { agenteId: 'a', total: 2, resueltas: 1 },
      { agenteId: null, total: 1, resueltas: 0 },
    ])
  })

  it('sin filas no hay números inventados', () => {
    expect(resumirInforme([])).toMatchObject({ total: 0, medianaPrimeraRespuesta: null, medianaResolucion: null, porcentajeRespondidas: null })
  })
})

describe('duracionLegible', () => {
  it('formatea', () => {
    expect(duracionLegible(null)).toBe('—')
    expect(duracionLegible(0.2)).toBe('< 1 min')
    expect(duracionLegible(12)).toBe('12 min')
    expect(duracionLegible(60)).toBe('1 h')
    expect(duracionLegible(200)).toBe('3 h 20 min')
    expect(duracionLegible(60 * 52)).toBe('2 d 4 h')
  })
})
