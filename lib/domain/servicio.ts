/**
 * Servicio de cocina: quiénes desayunan y qué se vendió.
 *
 * Dos documentos que la cocina y la recepción imprimen todos los días:
 *
 *  · **Lista de desayuno.** Cuántos cubiertos preparar y para quién.
 *  · **Resumen de consumos vendidos.** Qué salió del frigobar y de la cocina en
 *    un período, para reponer stock y para el arqueo.
 *
 * Reglas puras: sin base, sin framework. Se prueban solas.
 */

import { diasEntre, sumarDias } from '@/lib/fechas'

/* ────────────────────────────────────────────────────── desayuno ──── */

/**
 * ¿Esta estadía desayuna en la fecha indicada?
 *
 * La regla no es obvia y es la que más se equivoca a mano. El desayuno se sirve
 * **a la mañana siguiente de cada noche dormida**:
 *
 *  · Quien hace **check-out hoy** SÍ desayuna: durmió anoche y come antes de
 *    irse. Olvidarlo deja a alguien sin cubierto, que es el error que se ve.
 *  · Quien hace **check-in hoy** NO desayuna hoy: llega a la tarde. Contarlo
 *    infla el pedido a cocina, que es el error que no se ve.
 *
 * El período es `[check_in, check_out)`, donde cada elemento es una NOCHE. Quien
 * durmió la noche `f - 1` desayuna la mañana `f`.
 */
export function desayunaEn(checkIn: string, checkOut: string, fecha: string): boolean {
  const nocheAnterior = sumarDias(fecha, -1)
  // Durmió esa noche si la noche anterior cae dentro de [check_in, check_out).
  return checkIn <= nocheAnterior && nocheAnterior < checkOut
}

export interface EstadiaServicio {
  reservaCodigo: string
  unidad: string
  huesped: string
  checkIn: string
  checkOut: string
  huespedes: number
  /** Anotaciones del huésped: alergias, restricciones, pedidos especiales. */
  notas?: string | null
}

export interface LineaDesayuno {
  unidad: string
  huesped: string
  reservaCodigo: string
  cubiertos: number
  /** `true` si se retira hoy: la cocina suele adelantarles el servicio. */
  seRetiraHoy: boolean
  notas: string | null
}

export interface ListaDesayuno {
  fecha: string
  lineas: LineaDesayuno[]
  totalCubiertos: number
  /** Cuántas de esas líneas se van hoy, para ordenar la salida del salón. */
  totalSeRetiran: number
}

/**
 * Arma la lista del día, ordenada por unidad.
 *
 * Se ordena por unidad y no por huésped porque así recorre el salón quien sirve:
 * la mesa se identifica por habitación.
 */
export function listaDeDesayuno(estadias: EstadiaServicio[], fecha: string): ListaDesayuno {
  const lineas = estadias
    .filter((e) => desayunaEn(e.checkIn, e.checkOut, fecha))
    .map((e) => ({
      unidad: e.unidad,
      huesped: e.huesped,
      reservaCodigo: e.reservaCodigo,
      cubiertos: Math.max(1, e.huespedes),
      seRetiraHoy: e.checkOut === fecha,
      notas: e.notas ?? null,
    }))
    .sort((a, b) => a.unidad.localeCompare(b.unidad, 'es', { numeric: true }))

  return {
    fecha,
    lineas,
    totalCubiertos: lineas.reduce((acc, l) => acc + l.cubiertos, 0),
    totalSeRetiran: lineas.filter((l) => l.seRetiraHoy).length,
  }
}

/* ────────────────────────────────────────────────────── consumos ──── */

export type CategoriaProducto = 'desayuno' | 'frigobar' | 'excursion' | 'traslado' | 'otro'

export interface ConsumoVendido {
  productoCodigo: string
  productoNombre: string
  categoria: CategoriaProducto
  cantidad: number
  precioUnitario: number
  fecha: string
}

export interface LineaVenta {
  productoCodigo: string
  productoNombre: string
  categoria: CategoriaProducto
  cantidad: number
  /** Suma de cantidad × precio del snapshot, no del precio actual del catálogo. */
  total: number
}

export interface ResumenVentas {
  desde: string
  hasta: string
  dias: number
  lineas: LineaVenta[]
  porCategoria: { categoria: CategoriaProducto; cantidad: number; total: number }[]
  totalGeneral: number
  totalUnidades: number
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Agrupa lo vendido en un período por producto y por categoría.
 *
 * Usa el `precio_unitario` guardado en cada consumo —que es una foto del momento
 * de la venta— y **no** el precio actual del catálogo. Si se recalculara con el
 * precio de hoy, cualquier ajuste de tarifa reescribiría la historia de ventas y
 * el arqueo de un mes cerrado cambiaría solo.
 */
export function resumenDeVentas(
  consumos: ConsumoVendido[],
  desde: string,
  hasta: string,
): ResumenVentas {
  const enRango = consumos.filter((c) => c.fecha >= desde && c.fecha <= hasta)

  const porProducto = new Map<string, LineaVenta>()
  for (const c of enRango) {
    const actual = porProducto.get(c.productoCodigo) ?? {
      productoCodigo: c.productoCodigo,
      productoNombre: c.productoNombre,
      categoria: c.categoria,
      cantidad: 0,
      total: 0,
    }
    actual.cantidad += c.cantidad
    actual.total += c.cantidad * c.precioUnitario
    porProducto.set(c.productoCodigo, actual)
  }

  const lineas = [...porProducto.values()]
    .map((l) => ({ ...l, total: redondear(l.total) }))
    // De mayor a menor facturación: lo que importa aparece primero.
    .sort((a, b) => b.total - a.total)

  const acumCategoria = new Map<CategoriaProducto, { cantidad: number; total: number }>()
  for (const l of lineas) {
    const a = acumCategoria.get(l.categoria) ?? { cantidad: 0, total: 0 }
    a.cantidad += l.cantidad
    a.total += l.total
    acumCategoria.set(l.categoria, a)
  }

  const porCategoria = [...acumCategoria.entries()]
    .map(([categoria, v]) => ({ categoria, cantidad: v.cantidad, total: redondear(v.total) }))
    .sort((a, b) => b.total - a.total)

  return {
    desde,
    hasta,
    // Inclusivo en ambos extremos: del 1 al 1 es un día, no cero.
    dias: Math.max(1, diasEntre(desde, hasta) + 1),
    lineas,
    porCategoria,
    totalGeneral: redondear(lineas.reduce((acc, l) => acc + l.total, 0)),
    totalUnidades: lineas.reduce((acc, l) => acc + l.cantidad, 0),
  }
}

export const ETIQUETAS_CATEGORIA_PRODUCTO: Record<CategoriaProducto, string> = {
  desayuno: 'Desayuno',
  frigobar: 'Frigobar',
  excursion: 'Excursiones',
  traslado: 'Traslados',
  otro: 'Otros',
}
