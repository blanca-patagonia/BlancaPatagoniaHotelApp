import { describe, it, expect } from 'vitest'
import { HORA_CHECK_IN, HORA_CHECK_OUT } from '@/lib/domain/hotel'

describe('horarios del hotel', () => {
  it('están en formato HH:MM de 24 horas', () => {
    // Se interpolan tal cual en correos, en el portal y en los recordatorios.
    for (const hora of [HORA_CHECK_IN, HORA_CHECK_OUT]) {
      expect(hora).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    }
  })

  it('el check-out es antes que el check-in: la unidad se libera antes de que entre el siguiente', () => {
    expect(HORA_CHECK_OUT < HORA_CHECK_IN).toBe(true)
  })
})
