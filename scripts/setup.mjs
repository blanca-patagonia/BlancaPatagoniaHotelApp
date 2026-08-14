#!/usr/bin/env node
/**
 * Deja el proyecto listo para trabajar, o dice exactamente qué falta.
 *
 * Por qué existe: hasta ahora poner el entorno en marcha exigía leer el README,
 * el CLAUDE.md y descubrir a los golpes que `supabase db reset` borra los
 * usuarios de auth. Este script hace lo que puede y, sobre todo, **no finge**:
 * si algo no está, lo dice con el comando concreto para resolverlo.
 *
 * No instala nada por su cuenta ni toca la base sin avisar.
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const raiz = process.cwd()
const pasos = []
let bloqueado = false

function ok(que, detalle = '') {
  pasos.push(`  ✅ ${que}${detalle ? ` — ${detalle}` : ''}`)
}

function falta(que, comoResolver) {
  pasos.push(`  ❌ ${que}\n       → ${comoResolver}`)
  bloqueado = true
}

function aviso(que, detalle) {
  pasos.push(`  ⚠️  ${que}\n       ${detalle}`)
}

function correr(cmd, args, timeout = 5000) {
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

console.log('\n── Puesta en marcha · Blanca Patagonia ───────────────────────\n')

// ── Node ─────────────────────────────────────────────────────────────────────
const [mayor, menor] = process.versions.node.split('.').map(Number)
if (mayor > 20 || (mayor === 20 && menor >= 12)) {
  ok('Node', `v${process.versions.node}`)
} else {
  falta(
    `Node v${process.versions.node} es anterior a 20.12`,
    'Actualizá Node: el seed usa --env-file-if-exists, que existe desde esa versión.',
  )
}

// ── Dependencias ─────────────────────────────────────────────────────────────
if (existsSync(`${raiz}/node_modules/.bin/vitest`)) {
  ok('Dependencias instaladas')
} else {
  falta('Faltan las dependencias', 'npm ci')
}

// ── Variables de entorno ─────────────────────────────────────────────────────
if (existsSync(`${raiz}/.env.local`)) {
  ok('.env.local presente')

  const requeridas = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  const ausentes = requeridas.filter((v) => !process.env[v])
  if (ausentes.length) {
    falta(
      `Faltan variables en .env.local: ${ausentes.join(', ')}`,
      'Copiá los valores de `npx supabase status` (ver .env.example).',
    )
  } else {
    ok('Variables de Supabase completas')
  }
} else {
  falta('No hay .env.local', 'cp .env.example .env.local && npx supabase status')
}

// ── Docker y base local ──────────────────────────────────────────────────────
if (correr('docker', ['info'], 4000) !== null) {
  ok('Docker disponible')

  const estado = correr('npx', ['supabase', 'status'], 15000)
  if (estado && estado.includes('API URL')) {
    ok('Supabase local levantado')
  } else {
    aviso(
      'Supabase local no está corriendo',
      'npx supabase start && npm run seed:usuarios',
    )
  }
} else {
  aviso(
    'Docker no está disponible',
    'Sin él, 43 tests de integración se saltean —incluido el anti-overbooking—\n' +
      '       y `npm test` sale en verde igual. No confundas eso con verificado.',
  )
}

// ── Resultado ────────────────────────────────────────────────────────────────
console.log(pasos.join('\n'))
console.log('\n──────────────────────────────────────────────────────────────')

if (bloqueado) {
  console.log('Faltan cosas para poder trabajar. Resolvé lo marcado con ❌ y volvé a correr:')
  console.log('  npm run setup\n')
  process.exit(1)
}

console.log('Todo listo. Para verificar el proyecto entero:')
console.log('  npm run check')
console.log('\nPara levantar el entorno de desarrollo:')
console.log('  npm run dev\n')
