import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contrato: toda tarea programada de `vercel.json` responde a GET.
 *
 * Vercel Cron llama con GET. `/api/cron/salud` y `/api/cron/ari` exportaban
 * sólo POST: respondían 405 y no corrían nunca, sin que nada lo avisara —el
 * chequeo de salud de cada 15 minutos no dejaba rastro de una caída de la base
 * a la madrugada—. Se lee el archivo real para que una tarea nueva no repita
 * el error.
 */
const RAIZ = process.cwd()
const crons = (
  JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')) as { crons: { path: string }[] }
).crons

describe('contrato: cada cron de vercel.json responde a GET', () => {
  it('hay tareas programadas que revisar', () => {
    expect(crons.length).toBeGreaterThan(0)
  })

  for (const { path } of crons) {
    it(`${path} exporta GET`, () => {
      const archivo = join(RAIZ, 'src', 'app', '(back-api)', path, 'route.ts')
      expect(existsSync(archivo), `no existe ${archivo}`).toBe(true)
      expect(readFileSync(archivo, 'utf8')).toMatch(/export (async )?function GET\b/)
    })
  }
})
