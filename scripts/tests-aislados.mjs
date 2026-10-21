#!/usr/bin/env node
/**
 * Corre la suite COMPLETA (incluidos los tests de base de datos) contra una base
 * local SOLO para tests, sin tocar la base de trabajo.
 *
 *     npm run test:aislado              → todo
 *     npm run test:aislado -- tests/base-de-datos/reservas   → un patrón
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * 24 archivos de tests escriben con `service_role` y limpian con `delete` sobre
 * `reservas`, `huespedes`, `tarifas` y `unidades`. La base local de
 * `supabase/` (puerto 54321) es la misma que usa `npm run dev` con los datos
 * cargados a mano: correr los tests ahí los borraba. Por eso, en la práctica,
 * los ~630 tests de base se salteaban siempre en desarrollo (2026-10-20).
 *
 * Este script usa el proyecto de `supabase-tests/` (puerto 55321): lo levanta
 * si hace falta, lo deja en cero con las migraciones del repo, siembra el
 * usuario admin y corre vitest con `EXIGIR_DB=1` y las cuatro variables que
 * pide `tests/apoyo/db.ts`. La base de trabajo no se toca en ningún paso.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKDIR = join(raiz, 'supabase-tests')
const PUERTO_TESTS = '55321'

function supabase(...args) {
  return execFileSync('npx', ['supabase', ...args, '--workdir', WORKDIR], {
    cwd: raiz,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function paso(texto) {
  process.stdout.write(`\n▸ ${texto}\n`)
}

/** Las variables de la base de tests, leídas del CLI (no de `.env.local`). */
function variablesDeLaBase() {
  const salida = supabase('status', '-o', 'env')
  const env = Object.fromEntries(
    salida
      .split('\n')
      .map((l) => /^([A-Z_]+)="?([^"]*)"?$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  )
  if (!env.API_URL?.includes(PUERTO_TESTS)) {
    // Nunca seguir si el CLI respondiera por otra base: lo que sigue la resetea.
    throw new Error(`La base de tests no está en el puerto ${PUERTO_TESTS} (respondió ${env.API_URL}). Corto.`)
  }
  return env
}

paso('Levantando la base de tests (supabase-tests/, puerto 55321)…')
try {
  variablesDeLaBase()
  process.stdout.write('  ya estaba levantada.\n')
} catch {
  supabase('start')
}
const base = variablesDeLaBase()

paso('Dejándola en cero con las migraciones del repo…')
// `--workdir supabase-tests`: resetea SÓLO la base de tests. La de trabajo
// (supabase/, 54321) es otro proyecto, con otros contenedores.
supabase('db', 'reset')

const env = {
  ...process.env,
  SUPABASE_URL: base.API_URL,
  NEXT_PUBLIC_SUPABASE_URL: base.API_URL,
  SUPABASE_SERVICE_ROLE_KEY: base.SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: base.ANON_KEY,
  EXIGIR_DB: '1',
}

paso('Sembrando el usuario admin (lo exigen los tests de facturación)…')
execFileSync('node', [join(raiz, 'scripts/seed-usuarios.mjs')], { cwd: raiz, env, stdio: 'inherit' })

paso('Corriendo los tests…')
const r = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], { cwd: raiz, env, stdio: 'inherit' })
process.exit(r.status ?? 1)
