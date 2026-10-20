import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * La deuda de la capa de datos no crece (trinquete).
 *
 * `AGENTS.md` la declara: las pantallas y acciones de `src/app/` hablan con
 * Supabase directamente en vez de pasar por un servicio de `src/lib/`. Cada
 * archivo así repite consultas que después divergen —el buscador global pedía
 * columnas que no existen y nadie lo vio hasta el 2026-10-20— y no se puede
 * testear sin una base.
 *
 * Migrarlos todos de una vez no es razonable. Lo que sí: que no suba.
 *
 * Se cuentan los LUGARES donde `src/app` crea un cliente de la base
 * (`crearClienteServidor(` / `crearClienteAdmin(`), no los archivos: partir un
 * archivo grande en varios —que es una mejora— no cambia ese número, y sumar
 * una consulta nueva en una pantalla sí.
 *
 * Si este test falla:
 *   · mové la consulta nueva a `src/lib/<modulo>/` y usala desde ahí, o
 *   · si sacaste accesos de otro lado, BAJÁ `TOPE` a lo que dé ahora.
 * Nunca lo subas: un trinquete que se sube cuando molesta no sirve.
 */
const TOPE = 268

const APP = join(process.cwd(), 'src', 'app')

function accesosDirectos(): number {
  return (readdirSync(APP, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .reduce((n, f) => n + (readFileSync(join(APP, f), 'utf8').match(/crearCliente(Servidor|Admin)\(/g)?.length ?? 0), 0)
}

describe('contrato: la deuda de la capa de datos no crece', () => {
  it(`a lo sumo ${TOPE} lugares de src/app crean un cliente de la base`, () => {
    const n = accesosDirectos()
    expect(
      n,
      `Hay ${n} lugares de src/app que crean un cliente de la base (tope ${TOPE}). ` +
        'Mové la consulta nueva a un servicio de src/lib/, o bajá TOPE si esto bajó.',
    ).toBeLessThanOrEqual(TOPE)
  })
})
