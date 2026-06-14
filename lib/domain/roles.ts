/**
 * Roles del sistema. Debe mantenerse en sincronía con el enum `rol_usuario`
 * de la base de datos (ver `supabase/migrations/0001_perfiles_y_roles.sql`).
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
