/**
 * Bootstrap de usuarios de staff (SOLO desarrollo local).
 *
 * Crea (o actualiza) un usuario administrador en Supabase Auth y le asigna el
 * rol `admin` en `perfiles`. Necesario porque el staff no se auto-registra.
 *
 * Uso:  npm run seed:usuarios
 *   Variables (con defaults de dev): ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NOMBRE.
 *   Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (de .env.local).
 */

import { createClient } from '@supabase/supabase-js'

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) {
  console.error('✗ Falta SUPABASE_SERVICE_ROLE_KEY (revisá .env.local).')
  process.exit(1)
}

const email = process.env.ADMIN_EMAIL ?? 'admin@blancapatagonia.local'
const password = process.env.ADMIN_PASSWORD ?? 'blancadev1234'
const nombre = process.env.ADMIN_NOMBRE ?? 'Administrador'

/*
  La contraseña por defecto está documentada en el README y en el repositorio:
  es pública. Sirve para levantar el entorno local sin fricción, pero si este
  script llegara a correrse contra una base real dejaría un administrador con
  una contraseña que cualquiera puede leer en GitHub.

  El corte se hace por la URL: `localhost` y `127.0.0.1` son inequívocamente
  desarrollo. Contra cualquier otra base hay que definir ADMIN_PASSWORD a mano.
  Se falla en lugar de generar una al azar: una contraseña aleatoria impresa en
  un log de deploy es casi tan mala, y encima da la sensación de que el problema
  está resuelto.
*/
const esLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)

if (!esLocal && !process.env.ADMIN_PASSWORD) {
  console.error(`✗ Te estás conectando a una base que no es local:\n    ${url}\n`)
  console.error('  La contraseña por defecto de este script es PÚBLICA: está en el')
  console.error('  README y en el repositorio. Usarla fuera de desarrollo dejaría un')
  console.error('  administrador accesible para cualquiera.\n')
  console.error('  Definí una contraseña propia antes de correrlo:\n')
  console.error('    ADMIN_PASSWORD="…" npm run seed:usuarios\n')
  process.exit(1)
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } })

async function obtenerUsuarioPorEmail(correo) {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  return data?.users.find((u) => u.email === correo) ?? null
}

const { data: creado, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { nombre },
})

let userId = creado?.user?.id

if (error) {
  // Probablemente ya existe: lo buscamos y actualizamos la contraseña.
  const existente = await obtenerUsuarioPorEmail(email)
  if (!existente) {
    console.error(`✗ No se pudo crear ni encontrar el usuario: ${error.message}`)
    process.exit(1)
  }
  userId = existente.id
  await db.auth.admin.updateUserById(userId, { password, user_metadata: { nombre } })
  console.log('• Usuario ya existente: se actualizó la contraseña.')
}

const { error: errPerfil } = await db
  .from('perfiles')
  .update({ rol: 'admin', nombre, activo: true })
  .eq('id', userId)

if (errPerfil) {
  console.error(`✗ No se pudo asignar el rol admin: ${errPerfil.message}`)
  process.exit(1)
}

console.log('\n✓ Administrador de desarrollo listo:')
console.log(`  Email:       ${email}`)
console.log(`  Contraseña:  ${password}`)
console.log('\n  ⚠️  Credencial de DESARROLLO. Cambiala en producción.\n')
