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
