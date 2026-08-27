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
      'Copiá los valores del panel de Supabase, en Project Settings → API keys.\n' +
        '       OJO: la secret key empieza con `sb_secret_`. La clave del protocolo S3\n' +
        '       del Storage se le parece y no sirve: falla todo lo que use service_role.',
    )
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const esLocal = url.includes('localhost') || url.includes('127.0.0.1')
    ok(
      'Variables de Supabase completas',
      esLocal ? 'apuntan a una base LOCAL' : 'apuntan al proyecto en la nube',
    )
  }
} else {
  falta(
    'No hay .env.local',
    'cp .env.example .env.local y completalo con las claves del panel de Supabase\n' +
      '       (Project Settings → API keys). Instructivo en COMO-LEVANTARLO.md.',
  )
}

// ── Base local: solo hace falta para los tests ───────────────────────────────
// El sistema corre contra Supabase en la nube, así que `npm run dev` no necesita
// nada de esto. Lo que sí exige una base local son los tests: hay 24 archivos que
// escriben con service_role —saltea RLS— y borran filas de reservas, huespedes,
// tarifas, unidades y tipos_unidad. Contra la base real destruyen datos del hotel.
if (correr('docker', ['info'], 4000) !== null) {
  ok('Docker disponible', 'hace falta solo para correr los tests')

  const estado = correr('npx', ['supabase', 'status'], 15000)
  if (estado && estado.includes('API URL')) {
    ok('Base local de tests levantada')
  } else {
    aviso(
      'La base local de tests no está corriendo',
      'Para `npm run dev` no importa. Para la suite completa:\n' +
        '       npx supabase start && npx supabase db reset && npm run seed:usuarios',
    )
  }
} else {
  aviso(
    'Docker no está disponible',
    'Para levantar el sistema no hace falta: la base está en la nube.\n' +
      '       Para los tests sí. Sin él, 43 de integración se saltean —incluido el\n' +
      '       anti-overbooking— y `npm test` sale en verde igual. Eso no es verificado.',
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
