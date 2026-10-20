import { patronOr } from '@/lib/listados'

/**
 * Las búsquedas de los listados que se pueden exportar, en un solo lugar.
 *
 * El botón «Exportar» de cada listado manda los filtros de la pantalla en la
 * URL. Durante mucho tiempo el exportador los recibía y **los ignoraba**: quien
 * buscaba «Pérez» y exportaba se llevaba el padrón entero, y quien bajaba los
 * gastos de una categoría se llevaba todos. Para que la pantalla y el archivo
 * no puedan volver a filtrar distinto, la condición se arma acá y la usan los dos.
 *
 * `termino` llega ya limpio de `terminoBusqueda()` (con `%` y `_` escapados).
 * Dentro de un `.or()` va por `patronOr()`; en un `.ilike()` suelto viaja como
 * parámetro y va tal cual (`patronOr` ahí le agrega comillas literales y la
 * búsqueda no encuentra nada).
 */

/** Huéspedes: apellido, nombre, documento o email. Para `.or()`. */
export function busquedaHuespedes(termino: string): string {
  const p = patronOr(termino)
  return `apellido.ilike.${p},nombre.ilike.${p},doc_numero.ilike.${p},email.ilike.${p}`
}

/** Una palabra en el nombre o el apellido del huésped. Para `.or()` (asistente de IA). */
export function condicionNombre(termino: string): string {
  const p = patronOr(termino)
  return `apellido.ilike.${p},nombre.ilike.${p}`
}

/** Proveedores: nombre o rubro. Para `.or()`. */
export function busquedaProveedores(termino: string): string {
  const p = patronOr(termino)
  return `nombre.ilike.${p},rubro.ilike.${p}`
}

/** Órdenes de mantenimiento: título o descripción. Para `.or()`. */
export function busquedaOrdenes(termino: string): string {
  const p = patronOr(termino)
  return `titulo.ilike.${p},descripcion.ilike.${p}`
}

/** Patrón de un `.ilike()` suelto (agencias, gastos, comprobantes). */
export function contiene(termino: string): string {
  return `%${termino}%`
}
