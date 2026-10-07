import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ESTADOS_RESERVA } from '@/lib/domain/reservas'

/**
 * Contrato: `ESTADOS_RESERVA` (lib/domain/reservas.ts) tiene que ser
 * exactamente el enum `estado_reserva` de la base — ni un estado de más, ni
 * uno de menos (Fase 2.1 del pulido integral, issue #85).
 *
 * El comentario de `reservas.ts` ya lo decía ("Debe mantenerse en sincronía
 * con el enum `estado_reserva` de la base"), pero nada lo comprobaba: era una
 * promesa de comentario, no una garantía. Si alguien agrega un estado nuevo
 * de un solo lado —una migración con `alter type ... add value` sin tocar el
 * dominio, o al revés— la máquina de estados de la app y la de la base
 * dejan de ser la misma cosa en silencio.
 *
 * No hace falta una base levantada para este test: lee las migraciones del
 * disco, igual que `tests/garantia-tarjeta.test.ts`. Así corre siempre, no
 * solo cuando hay Docker.
 */
describe('contrato: ESTADOS_RESERVA sincronizado con el enum de la base', () => {
  const DIR = join(process.cwd(), 'supabase', 'migrations')
  const archivos = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const migraciones = archivos.map((f) => ({
    archivo: f,
    texto: readFileSync(join(DIR, f), 'utf8'),
  }))

  function valoresDelEnum(): string[] {
    const valores: string[] = []

    // El enum nace en una sola migración ("create type ... as enum (...)").
    for (const { texto } of migraciones) {
      const creacion = texto.match(/create\s+type\s+estado_reserva\s+as\s+enum\s*\(([^)]*)\)/i)
      if (creacion) {
        for (const m of creacion[1].matchAll(/'([a-z_]+)'/g)) valores.push(m[1])
      }
    }

    // Y puede crecer más adelante con "alter type ... add value" — en dos
    // migraciones separadas, por la regla de SQLSTATE 55P04 (ver AGENTS.md).
    for (const { texto } of migraciones) {
      for (const m of texto.matchAll(
        /alter\s+type\s+estado_reserva\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([a-z_]+)'/gi,
      )) {
        valores.push(m[1])
      }
    }

    return valores
  }

  it('el enum nace en UNA sola migración (0005) y no se volvió a tocar', () => {
    const creaciones = migraciones.filter(({ texto }) =>
      /create\s+type\s+estado_reserva\s+as\s+enum/i.test(texto),
    )
    expect(creaciones.map((m) => m.archivo)).toEqual(['0005_reservas_ocupacion.sql'])
  })

  it('ESTADOS_RESERVA tiene exactamente los mismos valores que el enum de la base', () => {
    const delEnum = valoresDelEnum()

    // Que la extracción por regex haya encontrado algo: si el patrón de la
    // migración cambiara de forma y el regex dejara de matchear, este test
    // pasaría vacío contra vacío sin detectar nada — el mismo error que
    // `AGENTS.md` señala sobre los seeds condicionales.
    expect(delEnum.length, 'no se pudo leer ningún valor del enum en las migraciones').toBeGreaterThan(0)

    expect([...ESTADOS_RESERVA].sort()).toEqual([...delEnum].sort())
  })
})
