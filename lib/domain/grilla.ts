/**
 * Reglas de la grilla de ocupación (lógica pura).
 *
 * ── Qué resuelve ────────────────────────────────────────────────────────────
 *
 * La grilla de WinPAX tenía, debajo de las habitaciones, una **fila resumen por
 * día**: ocupadas, libres, pax, llegadas, salidas y % de ocupación. Es el dato
 * que recepción mira para saber si la noche está vendida, y no estaba en este
 * sistema: la pantalla mostraba indicadores del período completo (un promedio de
 * 14 o 30 días), que sirve para otra cosa. Un 60 % de ocupación en la quincena no
 * dice nada sobre si hoy quedan camas.
 *
 * También resuelve las **claves de estado** para que la grilla no comunique con
 * color solamente (ver `CLAVE_ESTADO` más abajo).
 *
 * ── Por qué vive en el dominio y no en la página ─────────────────────────────
 *
 * Son seis cuentas con bordes que se pueden equivocar de forma silenciosa —el día
 * de salida es el caso interesante— y ninguna necesita base ni sesión para
 * probarse. La convención del proyecto es explícita: las páginas orquestan, el
 * dominio decide.
 */

import { contieneDia, type Periodo } from '../fechas'
import type { EstadoReserva } from './reservas'

/* ───────────────────────────────────────────────── claves de estado ──── */

/**
 * Letra que identifica cada estado dentro de la celda.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * La grilla distinguía las estadías **sólo por color de fondo**: gris pendiente,
 * azul confirmada, verde pagada, naranja in-house. Para una de cada doce personas
 * con daltonismo —y el rojo-verde es el tipo más común— eso es un tablero de
 * bloques indistinguibles. Y no es un detalle estético: el color es lo único que
 * separaba «esta reserva está paga» de «esta reserva puede caerse».
 *
 * La celda mide unos 40 px, así que no entra una etiqueta de texto. Una letra sí,
 * y se lee sin depender del color. El nombre completo del estado va en el
 * `title`, en el `aria-label` y en la referencia al pie.
 *
 * Se eligieron letras que no se pisan entre sí: `P` pendiente, `C` confirmada,
 * `$` pagada (el símbolo dice «cobrada» sin ambigüedad y evita otra letra más),
 * `H` in-house.
 */
export const CLAVE_ESTADO: Record<string, string> = {
  pendiente: 'P',
  confirmada: 'C',
  pagada: '$',
  in_house: 'H',
}

/** Clave de un estado, con respaldo por si aparece uno nuevo sin mapear. */
export function claveEstado(estado: string): string {
  return CLAVE_ESTADO[estado] ?? '•'
}

/* ─────────────────────────────────────────────────────────── resumen ──── */

/** Lo mínimo que el resumen necesita saber de una estadía. */
export interface EstadiaGrilla {
  unidadId: string
  periodo: Periodo
  estado: EstadoReserva
  huespedes: number
}

export interface ResumenDia {
  dia: string
  /** Unidades con una estadía activa esa noche. */
  ocupadas: number
  /** Unidades activas sin ocupar esa noche. */
  libres: number
  /** Huéspedes alojados esa noche. */
  pax: number
  /** Estadías que empiezan ese día (check-in). */
  llegadas: number
  /** Estadías que terminan ese día (check-out). */
  salidas: number
  /** Ocupación del día, entero de 0 a 100. */
  ocupacionPct: number
}

/**
 * Resumen de cada día de la ventana visible.
 *
 * ── El borde que importa: el día de salida ──────────────────────────────────
 *
 * Los períodos son `[desde, hasta)` con el fin **excluido**, igual que el
 * `daterange` de Postgres. O sea: una estadía del 10 al 13 ocupa las noches del
 * 10, 11 y 12, y el 13 la unidad **está libre**. Por eso el día que figura como
 * salida no cuenta como ocupado ni suma pax: quien se va desocupó a las 10 de la
 * mañana y esa noche la cama se puede vender.
 *
 * Contarlo al revés —sumar la noche de salida— es el error clásico en este tipo
 * de grilla, e infla la ocupación tanto como el promedio de rotación del hotel.
 * El test lo fija explícitamente.
 *
 * `ocupadas` cuenta **unidades**, no estadías: si por un error de datos hubiera
 * dos estadías activas sobre la misma unidad la misma noche, la ocupación no
 * puede pasar del 100 %. La restricción de exclusión GiST (ADR 0002) lo impide en
 * la base, pero esta función no depende de esa garantía para dar un número
 * coherente.
 */
export function resumenPorDia(
  dias: readonly string[],
  totalUnidades: number,
  estadias: readonly EstadiaGrilla[],
): ResumenDia[] {
  return dias.map((dia) => {
    const ocupadasEnDia = new Set<string>()
    let pax = 0
    let llegadas = 0
    let salidas = 0

    for (const e of estadias) {
      if (contieneDia(e.periodo, dia)) {
        // Si dos estadías cayeran sobre la misma unidad, el Set las unifica; el
        // pax, en cambio, se suma, porque son personas distintas realmente
        // alojadas.
        ocupadasEnDia.add(e.unidadId)
        pax += e.huespedes
      }
      if (e.periodo.desde === dia) llegadas++
      // La salida se cuenta el día del check-out, que NO es una noche ocupada.
      if (e.periodo.hasta === dia) salidas++
    }

    const ocupadas = Math.min(ocupadasEnDia.size, totalUnidades)

    return {
      dia,
      ocupadas,
      libres: Math.max(0, totalUnidades - ocupadas),
      pax,
      llegadas,
      salidas,
      ocupacionPct: totalUnidades > 0 ? Math.round((ocupadas / totalUnidades) * 100) : 0,
    }
  })
}

/**
 * Tono de la celda de ocupación del resumen.
 *
 * Tres tramos, no un degradado: el número exacto ya está escrito al lado, así que
 * el color sólo tiene que responder «¿hay que preocuparse?». Los cortes son de
 * negocio, no estéticos:
 *
 * · **100 %** — completo. No queda nada para vender y hay que mirar la lista de
 *   espera antes de prometer una habitación por teléfono.
 * · **≥ 85 %** — casi completo. Es el umbral en que conviene dejar de dar
 *   descuentos y revisar el overbooking permitido.
 * · **resto** — hay lugar.
 */
export type TonoOcupacion = 'completo' | 'alto' | 'normal'

export function tonoOcupacion(pct: number): TonoOcupacion {
  if (pct >= 100) return 'completo'
  if (pct >= 85) return 'alto'
  return 'normal'
}

/** Total de la ventana, para los indicadores de arriba de la grilla. */
export interface TotalesVentana {
  nochesOcupadas: number
  nochesDisponibles: number
  ocupacionPct: number
  /** Llegadas de toda la ventana. */
  llegadas: number
  salidas: number
  /** Día con más ocupación, para señalar dónde aprieta. */
  diaMasCargado: ResumenDia | null
}

/**
 * Consolida el resumen diario en los totales de la ventana.
 *
 * Se calcula a partir de `resumenPorDia` y no en paralelo a propósito: si los
 * indicadores de arriba y la fila de abajo salieran de dos cuentas distintas,
 * tarde o temprano mostrarían números que no cierran entre sí, y el usuario no
 * tendría forma de saber cuál creer.
 */
export function totalesDeVentana(resumen: readonly ResumenDia[]): TotalesVentana {
  let nochesOcupadas = 0
  let nochesDisponibles = 0
  let llegadas = 0
  let salidas = 0
  let diaMasCargado: ResumenDia | null = null

  for (const r of resumen) {
    nochesOcupadas += r.ocupadas
    nochesDisponibles += r.ocupadas + r.libres
    llegadas += r.llegadas
    salidas += r.salidas
    if (!diaMasCargado || r.ocupacionPct > diaMasCargado.ocupacionPct) diaMasCargado = r
  }

  return {
    nochesOcupadas,
    nochesDisponibles,
    ocupacionPct: nochesDisponibles > 0 ? Math.round((nochesOcupadas / nochesDisponibles) * 100) : 0,
    llegadas,
    salidas,
    diaMasCargado,
  }
}
