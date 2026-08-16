/**
 * Reglas del punto de venta (lógica pura).
 *
 * ── Qué resuelve ────────────────────────────────────────────────────────────
 *
 * Hasta ahora un consumo se cargaba de a uno desde el detalle de la reserva.
 * Cerrar un frigobar de cinco artículos eran cinco operaciones, y las cinco líneas
 * quedaban sueltas: no había forma de saber que fueron el mismo recuento ni de
 * anular el recuento entero si se cargó en la habitación equivocada.
 *
 * Este módulo modela la **comanda**: un conjunto de líneas que se cargan juntas,
 * con su total, sus validaciones y su número.
 */

import type { CategoriaProducto } from './consumos'

/* ─────────────────────────────────────────────────── puntos de venta ──── */

/**
 * Dónde se vendió.
 *
 * Es el «departamento» de WinPAX en su forma mínima. El paso 8 va a formalizar la
 * jerarquía departamento/subdepartamento; esto alcanza para que la grilla del POS
 * agrupe los productos y para que los reportes sepan qué vendió cada sector.
 */
export const PUNTOS_VENTA = [
  'recepcion',
  'frigobar',
  'room_service',
  'restaurante',
  'excursiones',
] as const

export type PuntoVenta = (typeof PUNTOS_VENTA)[number]

export const ETIQUETAS_PUNTO: Record<PuntoVenta, string> = {
  recepcion: 'Recepción',
  frigobar: 'Frigobar',
  room_service: 'Room service',
  restaurante: 'Restaurante',
  excursiones: 'Excursiones',
}

export function esPuntoVenta(v: string): v is PuntoVenta {
  return (PUNTOS_VENTA as readonly string[]).includes(v)
}

/**
 * Punto de venta que corresponde por omisión a cada categoría de producto.
 *
 * Sirve para que la grilla venga preseleccionada con algo sensato: si alguien abre
 * el POS del frigobar, los productos de frigobar ya están ahí. No es una regla
 * rígida —una cerveza se puede vender en el restaurante— así que quien carga puede
 * cambiarlo.
 */
const PUNTO_POR_CATEGORIA: Record<CategoriaProducto, PuntoVenta> = {
  frigobar: 'frigobar',
  desayuno: 'restaurante',
  excursion: 'excursiones',
  traslado: 'recepcion',
  otro: 'recepcion',
}

export function puntoSugerido(categoria: CategoriaProducto): PuntoVenta {
  return PUNTO_POR_CATEGORIA[categoria] ?? 'recepcion'
}

/* ────────────────────────────────────────────────────────── comanda ──── */

/** Una línea de la comanda, tal como la arma la pantalla. */
export interface LineaComanda {
  productoId: string
  nombre: string
  cantidad: number
  precioUnitario: number
  /** Stock disponible, si el producto lo controla. `null` = no lleva control. */
  stock?: number | null
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function subtotalLinea(l: Pick<LineaComanda, 'cantidad' | 'precioUnitario'>): number {
  if (!Number.isFinite(l.cantidad) || !Number.isFinite(l.precioUnitario)) return 0
  return redondear(Math.max(0, l.cantidad) * Math.max(0, l.precioUnitario))
}

export function totalComanda(lineas: readonly LineaComanda[]): number {
  return redondear(lineas.reduce((acc, l) => acc + subtotalLinea(l), 0))
}

/** Sólo las líneas con cantidad: la grilla muestra todo el catálogo en cero. */
export function lineasCargadas(lineas: readonly LineaComanda[]): LineaComanda[] {
  return lineas.filter((l) => Number.isFinite(l.cantidad) && l.cantidad > 0)
}

/**
 * Devuelve los motivos por los que la comanda NO se puede cerrar.
 *
 * Vacío = se puede. Se valida antes de escribir nada: una comanda a medias en la
 * cuenta del huésped es peor que una comanda rechazada, porque hay que descubrirla
 * para poder corregirla.
 */
export function validarComanda(lineas: readonly LineaComanda[]): string[] {
  const motivos: string[] = []
  const cargadas = lineasCargadas(lineas)

  if (cargadas.length === 0) {
    motivos.push('Cargá al menos un producto con cantidad mayor que cero.')
    return motivos
  }

  for (const l of cargadas) {
    if (!Number.isInteger(l.cantidad)) {
      motivos.push(`La cantidad de «${l.nombre}» tiene que ser un número entero.`)
    }
    // El stock se comprueba acá y no sólo en la base: el mensaje puede decir
    // cuánto hay, que es lo que quien está en el mostrador necesita saber para
    // resolverlo con el huésped enfrente.
    if (l.stock != null && l.cantidad > l.stock) {
      motivos.push(`De «${l.nombre}» quedan ${l.stock} y se cargaron ${l.cantidad}.`)
    }
  }

  return motivos
}

/**
 * Filtra el catálogo por el término del buscador.
 *
 * Compara sin acentos y sin distinguir mayúsculas: quien busca «cafe» tiene que
 * encontrar «Café». Es la misma normalización que usa el lector de CSV de canales,
 * y por el mismo motivo — nadie escribe los acentos cuando busca rápido.
 */
export function filtrarCatalogo<T extends { nombre: string; codigo?: string }>(
  productos: readonly T[],
  termino: string,
): T[] {
  const t = normalizar(termino)
  if (!t) return [...productos]
  return productos.filter(
    (p) => normalizar(p.nombre).includes(t) || normalizar(p.codigo ?? '').includes(t),
  )
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
