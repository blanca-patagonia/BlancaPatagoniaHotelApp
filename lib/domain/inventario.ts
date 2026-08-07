/**
 * Reglas de inventario (lógica pura).
 *
 * Existe por un error concreto: el tablero de inicio avisaba «4 productos con
 * stock bajo» mientras Configuración → Inventario mostraba 0. Ninguno de los
 * dos estaba "roto" por su cuenta; el problema era que **cada pantalla escribía
 * su propia condición** y solo una contemplaba que hay artículos que no llevan
 * inventario.
 *
 * El catálogo mezcla dos cosas distintas:
 * · **Productos** con existencias — una gaseosa del frigobar: `stock` numérico.
 * · **Servicios** sin existencias — una excursión al Perito Moreno, un
 *   traslado: `stock` en `null`, porque no hay nada que contar.
 *
 * El tablero comparaba `Number(null ?? 0) <= 0`, que da **verdadero** para todo
 * servicio: los cuatro paseos aparecían como faltantes de stock. La regla vive
 * acá para que haya una sola definición de "stock bajo" en todo el sistema.
 */

export interface ArticuloInventario {
  /** `null` en los servicios: no llevan existencias. */
  stock: number | null
  stock_minimo: number | null
}

/** ¿El artículo lleva control de existencias? */
export function llevaStock(a: ArticuloInventario): boolean {
  return a.stock !== null
}

/**
 * ¿Hay que reponerlo?
 *
 * Un servicio nunca está bajo de stock: no tiene stock. Devolver `false` para
 * ellos es lo que evita el falso aviso.
 */
export function stockBajo(a: ArticuloInventario): boolean {
  if (!llevaStock(a)) return false
  return Number(a.stock) <= Number(a.stock_minimo ?? 0)
}

/** Artículos que hay que reponer. Una sola fuente para tablero y configuración. */
export function faltantes<T extends ArticuloInventario>(articulos: readonly T[]): T[] {
  return articulos.filter(stockBajo)
}
