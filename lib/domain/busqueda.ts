import { puedeAcceder, type Area } from './permisos'
import type { Rol } from './roles'

/**
 * Búsqueda global del panel.
 *
 * Nace de una necesidad concreta de recepción: alguien llama preguntando por su
 * reserva y hay que encontrarlo **mientras está al teléfono**, sin adivinar si
 * está cargado como huésped, como reserva o como cuenta de agencia.
 *
 * La regla que vive acá es de qué se puede buscar según el rol. No alcanza con
 * que la pantalla no muestre un módulo: si el buscador consultara todo, alguien
 * de housekeeping podría escribir el apellido de un huésped y ver datos que su
 * menú no le ofrece. Se apoya en los **mismos permisos** que arman la
 * navegación, en lugar de mantener una segunda lista.
 *
 * La seguridad real sigue siendo de la base (RLS): esto evita pedir lo que no
 * corresponde, no es lo que impide leerlo.
 */

/** Qué tipos de cosa sabe buscar el sistema. */
export const AMBITOS = ['reservas', 'huespedes', 'agencias', 'proveedores'] as const

export type Ambito = (typeof AMBITOS)[number]

/** Área del panel a la que pertenece cada ámbito, para resolver el permiso. */
const AREA_DEL_AMBITO: Record<Ambito, Area> = {
  reservas: 'reservas',
  huespedes: 'huespedes',
  agencias: 'agencias',
  proveedores: 'proveedores',
}

export const ETIQUETAS_AMBITO: Record<Ambito, string> = {
  reservas: 'Reservas',
  huespedes: 'Huéspedes',
  agencias: 'Agencias y empresas',
  proveedores: 'Proveedores',
}

/** Ámbitos que un rol tiene permitido buscar. */
export function ambitosPara(rol: Rol): Ambito[] {
  return AMBITOS.filter((a) => puedeAcceder(rol, AREA_DEL_AMBITO[a]))
}

/** ¿Ese rol puede buscar en ese ámbito? */
export function puedeBuscar(rol: Rol, ambito: Ambito): boolean {
  return puedeAcceder(rol, AREA_DEL_AMBITO[ambito])
}

/**
 * Normaliza lo que se escribió en la caja.
 *
 * Devuelve `null` cuando no vale la pena consultar: vacío, o tan corto que
 * traería medio sistema. Dos caracteres es el mínimo para que «Ru» encuentre a
 * Ruiz sin devolver todo.
 */
export function terminoBuscado(q: string | undefined): string | null {
  const limpio = (q ?? '').trim()
  if (limpio.length < 2) return null
  // Los comodines de PostgREST se escapan: sin esto, buscar «%» lista todo.
  return limpio.replace(/[%_]/g, (c) => `\\${c}`)
}
