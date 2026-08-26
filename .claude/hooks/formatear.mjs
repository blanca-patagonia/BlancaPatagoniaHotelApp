#!/usr/bin/env node
/**
 * PostToolUse · Write|Edit — corrige el estilo del archivo recién tocado.
 *
 * El proyecto NO tiene Prettier (ver package.json): el único formateador
 * disponible es `eslint --fix`. Agregar una dependencia es una decisión del
 * equipo, no de un hook, así que se usa lo que hay.
 *
 * Nunca bloquea. Un problema de estilo no justifica interrumpir el trabajo.
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const raiz = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

const trozos = []
for await (const t of process.stdin) trozos.push(t)

let ruta = ''
try {
  ruta = JSON.parse(Buffer.concat(trozos).toString('utf8'))?.tool_input?.file_path ?? ''
} catch {
  process.exit(0)
}

if (!ruta || !existsSync(ruta)) process.exit(0)
if (!/\.(ts|tsx|js|jsx|mjs)$/.test(ruta)) process.exit(0)

const eslint = `${raiz}/node_modules/.bin/eslint`
if (!existsSync(eslint)) process.exit(0)

try {
  execFileSync(eslint, ['--fix', ruta], {
    cwd: raiz,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 25_000,
  })
} catch (e) {
  // ESLint sale distinto de cero cuando quedan problemas sin autocorregir: eso
  // es información para quien está trabajando, no un fallo del hook.
  const salida = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim()
  if (salida) {
    console.error(`ESLint sobre ${ruta}:`)
    console.error(salida)
  }
}

process.exit(0)
