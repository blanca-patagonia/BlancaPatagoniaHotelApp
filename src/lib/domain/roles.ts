/**
 * Roles del sistema. Debe mantenerse en sincronía con el enum `rol_usuario`
 * de la base de datos (ver `supabase/migrations/0001_perfiles_y_roles.sql`).
 *
 * ⚠️ `sin_rol` existe en el enum de la base (migración 0032) y **no está acá a
 * propósito**. Es el rol con que nace un alta que no pasó por
 * `app/panel/usuarios`: no habilita nada. Al quedar fuera de esta lista,
 * `esRolValido` devuelve `false` y `obtenerSesion` (lib/auth/session.ts) rechaza
 * la sesión, que es exactamente lo que se busca.
 *
 * NO lo agregues a `ROLES` «para que la base y el código coincidan»: hacerlo
 * convertiría un perfil sin aprovisionar en una sesión válida y reabriría el
 * agujero que la 0032 cerró.
 */
export const ROLES = ['admin', 'gerencia', 'recepcion', 'housekeeping'] as const

export type Rol = (typeof ROLES)[number]

export const ETIQUETAS_ROL: Record<Rol, string> = {
  admin: 'Administrador',
  gerencia: 'Gerencia',
  recepcion: 'Recepción',
  housekeeping: 'Housekeeping',
}

export function esRolValido(valor: string): valor is Rol {
  return (ROLES as readonly string[]).includes(valor)
}
