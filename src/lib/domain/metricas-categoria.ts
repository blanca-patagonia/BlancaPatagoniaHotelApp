import { metricasDeMes, type EstadiaMetrica } from './metricas'

/**
 * Venta por categoría de alojamiento.
 *
 * Lo pidió el hotel: «informe de venta x categoría». Es la columna «Tipo Hab»
 * de WinPAX —STD, SUP, TRI, CA2…— y la pregunta que hay detrás es cuál de los
 * tipos le deja más plata al hotel, que es la misma que ya se responde por
 * canal en `metricas-canal.ts`.
 *
 * No hay vista SQL nueva y es a propósito: la cuenta por tipo es exactamente la
 * misma que la del mes entero, sólo que aplicada a un subconjunto de estadías y
 * de unidades. Reusar `metricasDeMes` en vez de reescribir la aritmética en SQL
 * mantiene una sola definición de ocupación, ADR y RevPAR en todo el sistema:
 * si mañana cambia cómo se cuenta una noche, cambia en un solo lugar y los dos
 * informes se mueven juntos.
 *
 * ⚠️ Se agrupa por `estadias.tipo_unidad_id` y NO por el tipo de la unidad
 * actual. Son distintos después de una mudanza entre tipos (migración 0028
 * actualiza el tipo de la estadía justamente para que no mienta sobre qué se
 * vendió), y lo que un informe de venta tiene que decir es qué se vendió.
 */

/** Una estadía, con el tipo con el que se vendió. */
export interface EstadiaDeTipo extends EstadiaMetrica {
  tipoUnidadId: string | null
}

/** Un tipo de unidad del catálogo, con su inventario activo. */
export interface TipoConInventario {
  id: string
  codigo: string
  nombre: string
  categoria: string
  /** Unidades activas de este tipo. Es el denominador de la ocupación. */
  unidades: number
}

/** Lo vendido por un tipo en un mes. */
export interface VentaDeTipo {
  tipoId: string
  codigo: string
  nombre: string
  categoria: string
  unidades: number
  nochesVendidas: number
  nochesDisponibles: number
  ingreso: number
  /** ADR: ingreso por noche vendida. `null` si no vendió ninguna. */
  adr: number | null
  /** RevPAR e ocupación piden inventario; sin unidades activas no existen. */
  ocupacionPct: number | null
  revpar: number | null
  /** Qué parte del ingreso del mes explica este tipo. `null` si el mes no vendió. */
  participacionPct: number | null
  /**
   * El tipo vendió noches pero hoy no tiene ninguna unidad activa.
   *
   * Pasa con un tipo dado de baja después de haber vendido. La ocupación de ese
   * tipo no es 0 %: **no existe**, porque no hay denominador. Mostrar 0 % haría
   * ver como vacío lo que en realidad se vendió entero.
   */
  sinInventario: boolean
}

/** Totales del mes, para el pie de la tabla. */
export interface TotalesDeVenta {
  nochesVendidas: number
  nochesDisponibles: number
  ingreso: number
  adr: number | null
  ocupacionPct: number | null
  revpar: number | null
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Reparte las estadías del mes entre los tipos y calcula la venta de cada uno.
 *
 * Se devuelven **todos** los tipos recibidos, incluidos los que no vendieron
 * nada: un tipo ausente de la tabla se lee como «no lo miré», y un tipo en cero
 * es justamente el dato que hay que ver. Y se suman también los tipos que
 * vendieron sin estar ya en el catálogo activo, para que la suma de la columna
 * de ingresos coincida con el ingreso del mes.
 */
export function ventaPorTipo(
  estadias: readonly EstadiaDeTipo[],
  tipos: readonly TipoConInventario[],
  mes: string,
): VentaDeTipo[] {
  const porTipo = new Map<string, EstadiaDeTipo[]>()
  for (const e of estadias) {
    const clave = e.tipoUnidadId ?? ''
    const lista = porTipo.get(clave)
    if (lista) lista.push(e)
    else porTipo.set(clave, [e])
  }

  // Un tipo que ya no está en el catálogo pero tiene ventas del mes: entra igual,
  // marcado sin inventario, para que la columna de ingresos cierre con el total.
  const conocidos = new Set(tipos.map((t) => t.id))
  const huerfanos: TipoConInventario[] = [...porTipo.keys()]
    .filter((id) => id && !conocidos.has(id))
    .map((id) => ({ id, codigo: '—', nombre: 'Tipo dado de baja', categoria: '', unidades: 0 }))

  const filas = [...tipos, ...huerfanos].map((t): VentaDeTipo => {
    const m = metricasDeMes(porTipo.get(t.id) ?? [], mes, t.unidades)
    const sinInventario = t.unidades === 0

    return {
      tipoId: t.id,
      codigo: t.codigo,
      nombre: t.nombre,
      categoria: t.categoria,
      unidades: t.unidades,
      nochesVendidas: m.nochesVendidas,
      nochesDisponibles: m.nochesDisponibles,
      ingreso: redondear(m.ingreso),
      adr: m.nochesVendidas > 0 ? redondear(m.ingreso / m.nochesVendidas) : null,
      ocupacionPct: sinInventario ? null : m.ocupacionPct,
      revpar: sinInventario ? null : m.revpar,
      participacionPct: null, // se completa abajo, cuando se conoce el total
      sinInventario,
    }
  })

  const ingresoTotal = filas.reduce((acc, f) => acc + f.ingreso, 0)
  for (const f of filas) {
    f.participacionPct = ingresoTotal > 0 ? redondear((f.ingreso / ingresoTotal) * 100) : null
  }

  // Por ingreso y no por código: la pregunta es cuál deja más plata, igual que
  // en el ranking de canales. A igual ingreso, alfabético, para que el orden no
  // baile entre dos cargas de la misma pantalla.
  return filas.sort((a, b) => b.ingreso - a.ingreso || a.codigo.localeCompare(b.codigo, 'es'))
}

/**
 * Totales del mes.
 *
 * El ADR del total **no** es el promedio de los ADR de cada tipo: es el ingreso
 * total sobre las noches totales. Promediar promedios le daría el mismo peso a
 * una cabaña que vendió dos noches que a una standard que vendió cincuenta.
 */
export function totalesDeVenta(filas: readonly VentaDeTipo[]): TotalesDeVenta {
  const nochesVendidas = filas.reduce((a, f) => a + f.nochesVendidas, 0)
  const nochesDisponibles = filas.reduce((a, f) => a + f.nochesDisponibles, 0)
  const ingreso = redondear(filas.reduce((a, f) => a + f.ingreso, 0))

  return {
    nochesVendidas,
    nochesDisponibles,
    ingreso,
    adr: nochesVendidas > 0 ? redondear(ingreso / nochesVendidas) : null,
    ocupacionPct:
      nochesDisponibles > 0 ? Math.round((nochesVendidas / nochesDisponibles) * 100) : null,
    revpar: nochesDisponibles > 0 ? redondear(ingreso / nochesDisponibles) : null,
  }
}

/** Agrupa las filas por categoría (hostería / cabañas), respetando el orden. */
export function agruparPorCategoria(
  filas: readonly VentaDeTipo[],
): { categoria: string; filas: VentaDeTipo[] }[] {
  const grupos = new Map<string, VentaDeTipo[]>()
  for (const f of filas) {
    const lista = grupos.get(f.categoria)
    if (lista) lista.push(f)
    else grupos.set(f.categoria, [f])
  }
  return [...grupos.entries()].map(([categoria, filas]) => ({ categoria, filas }))
}
