#!/usr/bin/env node
/**
 * SessionStart — contexto real al arrancar, para no trabajar a ciegas.
 *
 * Degrada con elegancia: si no hay git, ni Docker, ni dependencias, informa y
 * sigue. Nunca se cuelga ni bloquea el arranque de la sesión.
 */
import { existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const raiz = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

/** Ejecuta un comando y devuelve su salida, o null si falla o no existe. */
function correr(cmd, args, timeout = 3000) {
  try {
    return execFileSync(cmd, args, {
      cwd: raiz,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    }).trim()
  } catch {
    return null
  }
}

const linea = '─'.repeat(62)
console.error(`── Blanca Patagonia ${linea.slice(20)}`)

// ── Git ─────────────────────────────────────────────────────────────────────
if (correr('git', ['rev-parse', '--git-dir'])) {
  const rama = correr('git', ['branch', '--show-current']) || '(detached)'
  console.error(`Rama: ${rama}`)
  if (rama === 'main' || rama === 'master') {
    console.error('  ⚠️  Estás en main. El trabajo va en ramas: git checkout -b audit/fase-N-<tema>')
  }

  const estado = correr('git', ['status', '--porcelain']) ?? ''
  const sucios = estado ? estado.split('\n').filter(Boolean) : []
  if (sucios.length) {
    console.error(`Cambios sin commitear: ${sucios.length} archivo(s)`)
    sucios.slice(0, 8).forEach((l) => console.error(`  ${l}`))
    if (sucios.length > 8) console.error(`  … y ${sucios.length - 8} más`)
  } else {
    console.error('Árbol limpio.')
  }
} else {
  console.error('No es un repositorio git.')
}

// ── Última migración: dice con qué número sigue la próxima ───────────────────
try {
  const sqls = readdirSync(`${raiz}/supabase/migrations`)
    .filter((n) => n.endsWith('.sql'))
    .sort()
  if (sqls.length) console.error(`Última migración: ${sqls.at(-1)}`)
} catch {
  /* sin migraciones, no hay nada que informar */
}

// ── Base local de tests ─────────────────────────────────────────────────────
// El sistema corre contra Supabase hosted; esto solo condiciona a los tests.
if (correr('docker', ['info'], 3000) !== null) {
  console.error('Base de tests: Docker disponible (npx supabase start)')
} else {
  console.error('Base de tests: sin Docker → 43 tests de integración se van a saltear.')
}

// ── Dependencias ────────────────────────────────────────────────────────────
if (!existsSync(`${raiz}/node_modules/.bin/vitest`)) {
  console.error("⚠️  Faltan dependencias: corré 'npm ci'.")
}

console.error(linea)
process.exit(0)
