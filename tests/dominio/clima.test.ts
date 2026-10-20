import { describe, it, expect } from 'vitest'
import { descripcionClima, resumirPronostico, RAFAGA_FUERTE_KMH } from '@/lib/domain/clima'

describe('clima de El Calafate (para el asistente)', () => {
  it('traduce los códigos WMO más comunes', () => {
    expect(descripcionClima(0)).toBe('despejado')
    expect(descripcionClima(3)).toBe('nublado')
    expect(descripcionClima(63)).toBe('lluvia')
    expect(descripcionClima(73)).toBe('nieve')
    expect(descripcionClima(999)).toBe('tormenta')
  })

  it('resume el pronóstico y marca el viento fuerte (lo que suspende excursiones)', () => {
    const r = resumirPronostico({
      current: { temperature_2m: 8.4, wind_speed_10m: 30.2, wind_gusts_10m: 55.6, weather_code: 2 },
      daily: {
        time: ['2026-10-19', '2026-10-20'],
        temperature_2m_max: [12.6, 9.1],
        temperature_2m_min: [1.2, -0.4],
        precipitation_sum: [0, 2.34],
        wind_gusts_10m_max: [45, RAFAGA_FUERTE_KMH + 20],
        weather_code: [2, 61],
      },
    })
    expect(r.ahora).toEqual({ temperaturaC: 8, vientoKmh: 30, rafagaKmh: 56, cielo: 'parcialmente nublado' })
    expect(r.dias[0]).toMatchObject({ fecha: '2026-10-19', maximaC: 13, minimaC: 1, vientoFuerte: false })
    expect(r.dias[1]).toMatchObject({ cielo: 'lluvia', lluviaMm: 2.3, vientoFuerte: true })
  })

  it('sin datos no inventa valores', () => {
    expect(resumirPronostico({})).toMatchObject({ ahora: null, dias: [] })
  })
})
