/**
 * Reglas de ama de llaves (lógica pura).
 *
 * ── Qué falta hoy ────────────────────────────────────────────────────────────
 *
 * El tablero de housekeeping muestra las unidades y su estado de limpieza, y deja
 * asignarlas a una mucama. Le faltan las dos cosas que WinPAX tenía y que son las
 * que se usan de verdad:
 *
 *  1. **El contexto de la habitación.** «Sucia» no dice lo mismo si esa habitación
 *     tiene una llegada hoy a las 15:00 o si está libre toda la semana. Sin eso, el
 *     tablero es una lista de estados y el orden en que se limpia lo decide quien
 *     se acuerde de mirar la planilla de llegadas.
 *  2. **Los contadores por mucama** —asignadas, limpiadas, faltantes,
 *     inspeccionadas— que son con lo que se sabe si el turno va a cerrar.
 *
 * ── La regla que este módulo aporta ──────────────────────────────────────────
 *
 * **La prioridad.** Una habitación sucia con llegada hoy es urgente; una sucia que
 * se desocupó hoy es alta; el resto es normal. Es lo único que convierte una lista
 * de veinte habitaciones en un orden de trabajo.
 */

import type { EstadoHousekeeping } from './unidades'

/** Una unidad con el contexto que hace falta para priorizarla. */
export interface UnidadHousekeeping {
  id: string
  nombre: string
  estado: EstadoHousekeeping
  /** Perfil de la mucama asignada, o `null`. */
  asignadaA: string | null
  /** Tipo de unidad, para agrupar y para saber cuánto lleva limpiarla. */
  tipo: string
  /** Hay una estadía activa esa noche. */
  ocupada: boolean
  /** Alguien se va hoy: la habitación se libera y hay que prepararla. */
  saleHoy: boolean
  /** Alguien llega hoy: la habitación tiene que estar lista. */
  llegaHoy: boolean
  /** Hay una orden de mantenimiento abierta. */
  enReparacion: boolean
}

/* ─────────────────────────────────────────────────────────── prioridad ──── */

export const PRIORIDADES = ['urgente', 'alta', 'normal', 'sin_tarea'] as const
export type Prioridad = (typeof PRIORIDADES)[number]

export const ETIQUETAS_PRIORIDAD: Record<Prioridad, string> = {
  urgente: 'Urgente',
  alta: 'Prioridad alta',
  normal: 'Normal',
  sin_tarea: 'Sin tarea',
}

/**
 * Por qué esa prioridad. Se muestra al lado: «urgente» sin motivo no dice qué
 * hacer, y quien limpia necesita saber si puede dejarla para después.
 */
export const MOTIVOS_PRIORIDAD: Record<Prioridad, string> = {
  urgente: 'Llega alguien hoy y la habitación no está lista',
  alta: 'Se desocupó hoy: hay que prepararla',
  normal: 'Limpieza de rutina',
  sin_tarea: 'Ya está lista o no requiere trabajo',
}

/**
 * Prioridad de limpieza de una unidad.
 *
 * El orden de las comprobaciones es la regla, así que importa:
 *
 * 1. **Bloqueada** o en reparación → no es tarea de limpieza. Mandar a alguien a
 *    limpiar una habitación con una cañería rota es hacerle perder el viaje.
 * 2. **Limpia o inspeccionada** → no hay nada que hacer.
 * 3. **Sucia + llega hoy** → urgente. Es el único caso en que la demora tiene una
 *    consecuencia visible para el huésped: llegar a una habitación sin hacer.
 * 4. **Sucia + salió hoy** → alta. Hay que prepararla, pero todavía no hay nadie
 *    esperándola.
 * 5. El resto → normal.
 */
export function prioridadDe(u: UnidadHousekeeping): Prioridad {
  if (u.estado === 'bloqueada' || u.enReparacion) return 'sin_tarea'
  if (u.estado === 'limpia' || u.estado === 'inspeccionada') return 'sin_tarea'

  // A partir de acá está sucia.
  if (u.llegaHoy) return 'urgente'
  if (u.saleHoy) return 'alta'
  return 'normal'
}

const PESO: Record<Prioridad, number> = { urgente: 0, alta: 1, normal: 2, sin_tarea: 3 }

/**
 * Ordena la lista de trabajo.
 *
 * Primero por prioridad y después por nombre de unidad, para que dentro de la misma
 * prioridad el recorrido sea el del pasillo y no uno arbitrario que cambie en cada
 * carga de pantalla.
 */
export function ordenarPorPrioridad(unidades: readonly UnidadHousekeeping[]): UnidadHousekeeping[] {
  return [...unidades].sort((a, b) => {
    const d = PESO[prioridadDe(a)] - PESO[prioridadDe(b)]
    if (d !== 0) return d
    return a.nombre.localeCompare(b.nombre, 'es', { numeric: true })
  })
}

/* ────────────────────────────────────────────────────────── contadores ──── */

export interface ContadoresHousekeeping {
  /** Unidades asignadas a esta mucama (o al conjunto). */
  asignadas: number
  /** Ya limpias, todavía sin inspeccionar. */
  limpiadas: number
  /** Inspeccionadas: el trabajo cerrado. */
  inspeccionadas: number
  /** Sucias todavía: lo que falta del turno. */
  faltantes: number
  /** Bloqueadas o en reparación: no cuentan como trabajo pendiente. */
  fueraDeServicio: number
  /** De las faltantes, cuántas son urgentes. */
  urgentes: number
}

/**
 * Contadores de un conjunto de unidades.
 *
 * `faltantes` **no incluye** las bloqueadas ni las que están en reparación. Es
 * deliberado: si las contara, el turno nunca cerraría en cero y el número dejaría
 * de servir para saber si falta trabajo.
 */
export function contadores(unidades: readonly UnidadHousekeeping[]): ContadoresHousekeeping {
  let limpiadas = 0
  let inspeccionadas = 0
  let faltantes = 0
  let fueraDeServicio = 0
  let urgentes = 0

  for (const u of unidades) {
    if (u.estado === 'bloqueada' || u.enReparacion) {
      fueraDeServicio++
      continue
    }
    if (u.estado === 'inspeccionada') inspeccionadas++
    else if (u.estado === 'limpia') limpiadas++
    else {
      faltantes++
      if (prioridadDe(u) === 'urgente') urgentes++
    }
  }

  return {
    asignadas: unidades.length,
    limpiadas,
    inspeccionadas,
    faltantes,
    fueraDeServicio,
    urgentes,
  }
}

/** Contadores por mucama, para ver de un vistazo cómo viene cada turno. */
export function contadoresPorMucama(
  unidades: readonly UnidadHousekeeping[],
): { mucamaId: string | null; contadores: ContadoresHousekeeping }[] {
  const porMucama = new Map<string | null, UnidadHousekeeping[]>()

  for (const u of unidades) {
    const clave = u.asignadaA ?? null
    porMucama.set(clave, [...(porMucama.get(clave) ?? []), u])
  }

  return [...porMucama.entries()]
    .map(([mucamaId, us]) => ({ mucamaId, contadores: contadores(us) }))
    // Las sin asignar al final: son el pendiente de organizar, no un turno.
    .sort((a, b) => {
      if (a.mucamaId === null) return 1
      if (b.mucamaId === null) return -1
      return b.contadores.faltantes - a.contadores.faltantes
    })
}

/**
 * Porcentaje de avance del turno.
 *
 * Sobre el trabajo **real**: las fuera de servicio se descuentan del denominador,
 * porque si no el avance nunca llegaría a 100 % y dejaría de significar «terminé».
 */
export function avance(c: ContadoresHousekeeping): number {
  const trabajo = c.asignadas - c.fueraDeServicio
  if (trabajo <= 0) return 100
  return Math.round(((c.limpiadas + c.inspeccionadas) / trabajo) * 100)
}

/* ─────────────────────────────────────────────── siguiente estado ──── */

/**
 * Estado al que pasa una unidad cuando la mucama la marca como hecha.
 *
 * Es el flujo de un toque: sucia → limpia. La inspección la hace la gobernanta o
 * gerencia, así que la mucama **no** pasa de limpia a inspeccionada — si pudiera,
 * el control de calidad lo firmaría quien hizo el trabajo.
 */
export function siguienteEstadoMucama(actual: EstadoHousekeeping): EstadoHousekeeping | null {
  if (actual === 'sucia') return 'limpia'
  // Desde limpia, inspeccionada o bloqueada la mucama no avanza sola.
  return null
}

/** Texto del botón de la vista móvil, según el estado. */
export function accionMucama(actual: EstadoHousekeeping): string | null {
  return siguienteEstadoMucama(actual) === 'limpia' ? 'Marcar limpia' : null
}
