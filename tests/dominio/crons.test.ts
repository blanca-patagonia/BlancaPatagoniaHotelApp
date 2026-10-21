import { describe, it, expect } from 'vitest'
import { CRONS, cronsAtrasados } from '@/lib/domain/crons'

describe('cronsAtrasados', () => {
  const ahora = new Date('2026-10-19T12:00:00Z')
  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString()

  it('una tarea al día no avisa', () => {
    const corridas = (Object.keys(CRONS) as (keyof typeof CRONS)[]).map((nombre) => ({
      nombre,
      ultima_ok: hace(5),
    }))
    expect(cronsAtrasados(corridas, ahora)).toEqual([])
  })

  it('una tarea que nunca corrió avisa (el cron que no se configuró)', () => {
    const atrasados = cronsAtrasados([], ahora).map((c) => c.nombre)
    expect(atrasados).toContain('mantenimiento')
    expect(atrasados).toHaveLength(Object.keys(CRONS).length)
  })

  it('avisa cuando se pasa de su tolerancia, no antes', () => {
    const base = (Object.keys(CRONS) as (keyof typeof CRONS)[]).map((nombre) => ({ nombre, ultima_ok: hace(5) }))
    const conAvisos = base.map((c) => (c.nombre === 'notificaciones' ? { ...c, ultima_ok: hace(31) } : c))
    expect(cronsAtrasados(conAvisos, ahora).map((c) => c.nombre)).toEqual(['notificaciones'])
    const enElLimite = base.map((c) => (c.nombre === 'notificaciones' ? { ...c, ultima_ok: hace(29) } : c))
    expect(cronsAtrasados(enElLimite, ahora)).toEqual([])
  })
})
