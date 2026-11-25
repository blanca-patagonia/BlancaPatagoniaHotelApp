import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DIAS_EXPIRACION } from '@/lib/domain/expiracion'

describe('días que una reserva pendiente retiene la unidad', () => {
  it('son cinco', () => {
    expect(DIAS_EXPIRACION).toBe(5)
  })

  it('la tarea de mantenimiento usa esta misma constante y no un número propio', () => {
    const fuente = readFileSync(
      join(process.cwd(), 'src/app/(back-api)/api/cron/mantenimiento/route.ts'),
      'utf8',
    )
    expect(fuente).toContain("from '@/lib/domain/expiracion'")
    expect(fuente).toMatch(/p_dias:\s*DIAS_EXPIRACION/)
  })
})
