import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { clienteDePrueba, hayAnon } from './db'
import type { Rol } from '@/lib/domain/roles'

/**
 * Clientes autenticados **como cada rol de staff**.
 *
 * ── Por qué esto no existía y por qué importa ────────────────────────────────
 *
 * `tests/db.ts` da dos clientes: `service_role` (saltea RLS) y `anon` (el borde
 * público). Con esos dos se puede verificar que un extraño no vea nada, y eso ya
 * está hecho.
 *
 * Lo que **nunca se pudo probar** es el borde *entre* roles de staff: que
 * housekeeping no lea el padrón de huéspedes, que recepción no toque la
 * configuración, que gerencia no cree usuarios. Las ~75 políticas RLS dicen cosas
 * como `rol_actual() in ('admin','gerencia','recepcion')`, y hasta acá nadie las
 * había ejecutado con un `rol_actual()` que devolviera algo distinto de `null`.
 *
 * Ése es el pendiente más grande de la auditoría de seguridad, y la razón por la
 * que seguía abierto: hacía falta este archivo.
 *
 * ── Cómo funciona ───────────────────────────────────────────────────────────
 *
 * Se crea un usuario de Supabase Auth por rol con `service_role`, se le fija el rol
 * en `perfiles` —la migración 0032 hace que el alta nazca **sin** privilegios, así
 * que hay que asignarlo a mano, que es exactamente lo que se quiere probar— y se
 * inicia sesión con la clave publicable. El cliente resultante pasa por RLS igual
 * que el navegador de esa persona.
 *
 * ⚠️ Los usuarios quedan en `auth.users` y en `perfiles`. `limpiarUsuarios()` los
 * borra; llamarla en `afterAll`.
 */

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Hace falta la clave publicable además de la de servicio: sin ella no se puede
 * iniciar sesión, y `EXIGIR_DB` **no** la cubre (ver `tests/db.ts:40`).
 */
export const hayRoles = hayAnon

export interface UsuarioDePrueba {
  rol: Rol
  id: string
  email: string
  /** Cliente autenticado como esa persona. Pasa por RLS. */
  cliente: SupabaseClient
}

const creados: string[] = []

/** Contraseña de los usuarios de prueba. Solo viven en la base local. */
const PASS = 'prueba-rls-1234'

/**
 * Crea un usuario con el rol pedido y devuelve su cliente autenticado.
 *
 * El `email_confirm: true` es necesario: sin confirmar, `signInWithPassword`
 * rechaza y el test fallaría por un motivo que no tiene nada que ver con lo que
 * quiere probar.
 */
export async function crearUsuarioConRol(rol: Rol, sufijo: string): Promise<UsuarioDePrueba> {
  const admin = clienteDePrueba()
  const email = `rls-${rol}-${sufijo}@example.com`

  const { data: creado, error: eAlta } = await admin.auth.admin.createUser({
    email,
    password: PASS,
    email_confirm: true,
  })
  if (eAlta || !creado.user) {
    throw new Error(`No se pudo crear el usuario ${rol}: ${eAlta?.message ?? 'sin usuario'}`)
  }

  const id = creado.user.id
  creados.push(id)

  // El perfil lo crea un trigger SIN rol (migración 0032 + 0035, ADR 0017). Se
  // asigna acá con `service_role`, que es el único camino permitido — y es
  // justamente la garantía que se quiere seguir teniendo.
  const { error: ePerfil } = await admin
    .from('perfiles')
    .update({ rol, activo: true, nombre: `Prueba ${rol}` })
    .eq('id', id)

  if (ePerfil) throw new Error(`No se pudo asignar el rol ${rol}: ${ePerfil.message}`)

  const cliente = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: eLogin } = await cliente.auth.signInWithPassword({ email, password: PASS })
  if (eLogin) throw new Error(`No se pudo iniciar sesión como ${rol}: ${eLogin.message}`)

  return { rol, id, email, cliente }
}

/** Crea los cuatro roles de una vez. */
export async function crearLosCuatroRoles(sufijo: string): Promise<Record<Rol, UsuarioDePrueba>> {
  const roles: Rol[] = ['admin', 'gerencia', 'recepcion', 'housekeeping']
  const salida = {} as Record<Rol, UsuarioDePrueba>

  // En serie y no en paralelo: crear usuarios de auth concurrentemente en el stack
  // local a veces devuelve 500, y un test que falla por eso no dice nada sobre RLS.
  for (const rol of roles) salida[rol] = await crearUsuarioConRol(rol, sufijo)

  return salida
}

/**
 * Un usuario **autenticado pero sin rol**: el estado en el que nace todo alta
 * desde la migración 0032.
 *
 * Es un borde propio y vale probarlo: `rol_actual()` devuelve `null`, así que para
 * RLS es indistinguible de `anon` aunque tenga sesión válida. Si alguna política
 * usara `auth.uid() is not null` en lugar de `rol_actual()`, esta persona pasaría.
 */
export async function crearUsuarioSinRol(sufijo: string): Promise<UsuarioDePrueba> {
  const admin = clienteDePrueba()
  const email = `rls-sinrol-${sufijo}@example.com`

  const { data: creado, error } = await admin.auth.admin.createUser({
    email,
    password: PASS,
    email_confirm: true,
  })
  if (error || !creado.user) throw new Error(`No se pudo crear el usuario sin rol: ${error?.message}`)

  creados.push(creado.user.id)

  const cliente = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await cliente.auth.signInWithPassword({ email, password: PASS })

  // `rol` queda como lo dejó el trigger. No se toca.
  return { rol: 'housekeeping', id: creado.user.id, email, cliente }
}

/** Borra los usuarios creados. Llamar en `afterAll`. */
export async function limpiarUsuarios(): Promise<void> {
  const admin = clienteDePrueba()
  for (const id of creados) {
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  creados.length = 0
}
