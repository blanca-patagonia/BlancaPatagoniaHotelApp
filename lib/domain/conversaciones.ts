/**
 * Reglas del chat interno (lógica pura).
 *
 * Se diferencia del módulo Avisos: aquel es una cartelera unidireccional; esto
 * es una conversación por área. Quién puede entrar a cada canal se decide acá y
 * lo vuelve a imponer RLS en la base (función `puede_ver_canal`).
 */

import type { Rol } from './roles'

/** Largo máximo de un mensaje, para que el chat no se use como repositorio. */
export const MAX_MENSAJE = 1000

/**
 * Un rol participa de un canal si está en su lista.
 *
 * `admin` entra a todos: es el rol de soporte del sistema y necesita ver
 * cualquier conversación para diagnosticar.
 */
export function puedeParticipar(rol: Rol, rolesDelCanal: readonly Rol[]): boolean {
  return rol === 'admin' || rolesDelCanal.includes(rol)
}

/** Canales visibles para un rol, en el orden en que vienen. */
export function canalesVisibles<T extends { roles: readonly Rol[] }>(
  rol: Rol,
  canales: readonly T[],
): T[] {
  return canales.filter((c) => puedeParticipar(rol, c.roles))
}

/** Recorta espacios sobrantes y limita el largo. */
export function normalizarMensaje(texto: string): string {
  return texto.trim().slice(0, MAX_MENSAJE)
}

/** Un mensaje vale si tiene contenido después de recortarlo. */
export function mensajeValido(texto: string): boolean {
  return normalizarMensaje(texto).length > 0
}

/**
 * Agrupa mensajes consecutivos del mismo autor para mostrarlos como un bloque,
 * como hace cualquier chat. Solo agrupa si además están cerca en el tiempo.
 */
export const MINUTOS_AGRUPACION = 5

export function agrupaConAnterior(
  actual: { autor_id: string | null; creado_en: string },
  anterior: { autor_id: string | null; creado_en: string } | undefined,
): boolean {
  if (!anterior) return false
  if (actual.autor_id !== anterior.autor_id) return false
  const diff = new Date(actual.creado_en).getTime() - new Date(anterior.creado_en).getTime()
  return diff >= 0 && diff <= MINUTOS_AGRUPACION * 60_000
}
