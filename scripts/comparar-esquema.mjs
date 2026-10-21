#!/usr/bin/env node
/**
 * ¿La base tiene EXACTAMENTE el esquema que arman las migraciones del repo?
 *
 *     npm run esquema:comparar                      → la base de trabajo local (54321)
 *     ESQUEMA_DB_URL='postgresql://…' npm run esquema:comparar   → otra (la de la nube)
 *
 * Compara el esquema `public` de la base indicada contra el de la base de tests
 * (`supabase-tests/`), recién reseteada con las migraciones. Imprime las
 * diferencias y sale con código 1 si hay alguna.
 *
 * ── Por qué no alcanza con `supabase migration list` ────────────────────────
 *
 * El registro de migraciones dice qué se ANOTÓ, no qué se aplicó. El 2026-10-20
 * la base local tenía anotada la 0087 sin la tabla `canal_restricciones`, y
 * aplicadas sin anotar otras doce; seis más no estaban ni anotadas ni
 * aplicadas (entre ellas la 0114: reprogramar una reserva fallaba). Sólo
 * comparando el esquema real se vio.
 *
 * ⚠️ La URL de la nube lleva la contraseña de la base: va por variable de
 * entorno y no se imprime.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKDIR_TESTS = join(raiz, 'supabase-tests')

function npx(args, workdir) {
  return execFileSync('npx', ['supabase', ...args, ...(workdir ? ['--workdir', workdir] : [])], {
    cwd: raiz,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** Sin comentarios, líneas vacías ni las marcas que cambian en cada volcado. */
function normalizar(sql) {
  return sql
    .split('\n')
    .filter((l) => l.trim() && !/^--|^SET |^SELECT pg_catalog|^\\(un)?restrict/.test(l))
}

process.stdout.write('▸ Base de referencia: supabase-tests/, reseteada con las migraciones del repo…\n')
try {
  npx(['status'], WORKDIR_TESTS)
} catch {
  npx(['start'], WORKDIR_TESTS)
}
npx(['db', 'reset'], WORKDIR_TESTS)
const referencia = normalizar(npx(['db', 'dump', '--local', '-s', 'public'], WORKDIR_TESTS))

const url = process.env.ESQUEMA_DB_URL
process.stdout.write(`▸ Base a verificar: ${url ? 'la de ESQUEMA_DB_URL' : 'la local de trabajo (supabase/)'}…\n`)
const objetivo = normalizar(url ? npx(['db', 'dump', '--db-url', url, '-s', 'public']) : npx(['db', 'dump', '--local', '-s', 'public']))

const enRef = new Set(referencia)
const enObj = new Set(objetivo)
const faltan = referencia.filter((l) => !enObj.has(l))
const sobran = objetivo.filter((l) => !enRef.has(l))

if (faltan.length === 0 && sobran.length === 0) {
  process.stdout.write('✓ El esquema coincide con las migraciones del repo.\n')
  process.exit(0)
}
const mostrar = (titulo, lineas) => {
  if (lineas.length === 0) return
  process.stdout.write(`\n${titulo} (${lineas.length} líneas):\n`)
  for (const l of lineas.slice(0, 60)) process.stdout.write(`  ${l.slice(0, 160)}\n`)
  if (lineas.length > 60) process.stdout.write(`  … y ${lineas.length - 60} más\n`)
}
mostrar('FALTA en la base (está en las migraciones)', faltan)
mostrar('SOBRA en la base (no viene de ninguna migración)', sobran)
process.stdout.write(
  '\nCon «falta»: hay migraciones sin aplicar. Buscá el objeto con `grep -l` en supabase/migrations.\n',
)
process.exit(1)
