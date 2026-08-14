#!/usr/bin/env node
/**
 * Stop — corre la suite al terminar la tarea y avisa si quedó algo roto.
 *
 * Informa además cuántos tests SE SALTEARON. Sin base local hoy se saltean 43,
 * entre ellos el anti-overbooking, que es la garantía central del sistema
 * (ADR 0002). Una suite verde con 43 tests sin ejecutar no es una suite verde,
 * y confundir una cosa con la otra es exactamente cómo se entrega algo roto.
 *
 * Nunca bloquea: informa.
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const raiz = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const vitest = `${raiz}/node_modules/.bin/vitest`

if (!existsSync(vitest)) process.exit(0)

let salida = ''
try {
  salida = execFileSync(vitest, ['run', '--reporter=basic'], {
    cwd: raiz,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 110_000,
  })
} catch (e) {
  // vitest sale distinto de cero cuando hay tests en rojo: la salida sigue
  // sirviendo y es justamente la que hay que mostrar.
  salida = `${e.stdout ?? ''}${e.stderr ?? ''}`
}

const resumen = salida.match(/^\s*Tests\s+.*$/m)?.[0]?.trim()
const fallidos = salida.match(/(\d+) failed/)?.[1]
const salteados = salida.match(/(\d+) skipped/)?.[1]

if (fallidos) {
  console.error(`⛔ Tests en rojo: ${fallidos}`)
  const detalle = salida.split('\n').filter((l) => /FAIL|AssertionError|✗/.test(l)).slice(0, 20)
  if (detalle.length) console.error(detalle.join('\n'))
  console.error("Corré 'npm test' para ver el detalle completo.")
  process.exit(0)
}

if (resumen) console.error(`✅ ${resumen}`)

if (salteados && Number(salteados) > 0) {
  console.error(`⚠️  ${salteados} tests sin ejecutar: los de integración necesitan la base local.`)
  console.error('   Incluyen el anti-overbooking. Verde acá NO significa verificado.')
  console.error('   Para correrlos: npx supabase start && npm run seed:usuarios')
}

process.exit(0)
