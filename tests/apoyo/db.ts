import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Acceso compartido a la base para los tests de integración.
 *
 * Los tests que tocan Postgres se **saltean** cuando no hay credenciales, para
 * que `npm test` siga siendo útil sin levantar Docker. El problema de saltear
 * en silencio es que en CI el badge queda verde **sin haber probado nada**:
 * justamente el anti-overbooking, que es la garantía central del sistema
 * (ADR 0002), es de los que se saltean.
 *
 * Por eso existe `EXIGIR_DB`: cuando vale `1` —como en el workflow de CI— la
 * falta de base es un **error**, no un salto. Si Supabase no levantó, la suite
 * falla y se ve.
 */

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const hayDB = Boolean(url && serviceKey && !url.includes('placeholder'))

/*
  Los tests NO se corren contra la base de la nube.

  Desde que el proyecto usa Supabase hosted, el `.env.local` de cualquier máquina
  apunta a la base real del hotel. Vitest no lee ese archivo, así que `npm test` a
  secas es inofensivo; el peligro es exportar las variables a mano, que es
  justamente lo que documentan `AGENTS.md` y el instructivo para no saltear los
  tests de integración.

  Lo que estaría en juego no es un dato de prueba: 24 archivos escriben con
  `service_role`, que saltea RLS **y** las revocaciones de `delete` de la
  migración 0061, y limpian haciendo `delete` sobre `reservas`, `huespedes`,
  `tarifas`, `unidades` y `tipos_unidad`. Contra la base real eso borra reservas
  del hotel, y el `delete` no avisa cuántas filas se llevó puestas.

  El corte se hace por la URL, igual que en `scripts/seed-usuarios.mjs`:
  `localhost` y `127.0.0.1` son inequívocamente desarrollo. No rompe el CI, que
  levanta su propia base con `supabase start` en `127.0.0.1`.

  La salida de escape existe —hay bases remotas legítimamente descartables, como
  una rama de Supabase— pero hay que pedirla a propósito.
*/
const esLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url ?? '')

if (hayDB && !esLocal && process.env.PERMITIR_DB_REMOTA !== '1') {
  throw new Error(
    `Los tests apuntan a una base que NO es local:\n    ${url}\n\n` +
      '  La suite escribe con `service_role` y limpia con `delete` sobre reservas,\n' +
      '  huespedes, tarifas y unidades. Contra la base real eso borra datos del hotel.\n\n' +
      '  Levantá la base local:  npx supabase start && npx supabase db reset\n' +
      '  y exportá SUPABASE_URL=http://127.0.0.1:54321 antes de correr los tests.\n\n' +
      '  Si de verdad querés correrlos contra una base remota descartable:\n' +
      '    PERMITIR_DB_REMOTA=1 npm test\n',
  )
}

if (process.env.EXIGIR_DB === '1' && !hayDB) {
  throw new Error(
    'EXIGIR_DB=1 pero faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. ' +
      'Los tests de integración se habrían salteado dejando el CI en verde sin ' +
      'verificar el anti-overbooking. Revisá que `supabase start` haya funcionado.',
  )
}

/*
  Destino inerte para cuando no hay base.

  `describe.skipIf(!hayDB)` marca los tests como salteados pero **igual ejecuta el
  cuerpo del `describe`** para recolectarlos. Tres archivos crean su cliente ahí
  (`const admin = clienteDePrueba()`), así que sin credenciales `createClient`
  lanzaba «supabaseUrl is required» y el archivo aparecía **fallado en vez de
  salteado**: son los tres que hacían que `npm test` sin base terminara en rojo
  mientras el código de salida seguía dando 0.

  Este cliente nunca llega a hacer una petición —los tests que lo usarían están
  salteados— y no debilita ninguna garantía: con `EXIGIR_DB=1`, la falta de base
  sigue cortando fuerte más arriba. La URL lleva `placeholder` a propósito, que es
  lo mismo que `hayDB` ya considera «sin base».
*/
const URL_SIN_BASE = 'http://placeholder.invalid'

/** Cliente con `service_role` para preparar y limpiar datos de prueba. */
export function clienteDePrueba(): SupabaseClient {
  return createClient(url ?? URL_SIN_BASE, serviceKey ?? 'sin-clave', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** Hay clave publicable para probar el borde público. */
export const hayAnon = Boolean(hayDB && anonKey)

/**
 * Cliente con la clave **publicable**, es decir con el rol `anon`.
 *
 * Sirve para probar el sistema como lo ve cualquiera desde internet: esa clave
 * viaja en el bundle del navegador por diseño, así que todo lo que este cliente
 * puede hacer es, literalmente, público. Es el único modo de verificar que las
 * políticas y las guardas no dejan pasar de más.
 */
export function clienteAnonimo(): SupabaseClient {
  // Mismo motivo que en `clienteDePrueba`: el cuerpo del `describe` corre aunque
  // los tests estén salteados.
  return createClient(url ?? URL_SIN_BASE, anonKey ?? 'sin-clave', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Sufijo aleatorio para que dos corridas no colisionen entre sí. */
export function sufijoUnico(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** Arma el literal de `daterange` que espera Postgres. */
export function periodo(desde: string, hasta: string): string {
  return `[${desde},${hasta})`
}
