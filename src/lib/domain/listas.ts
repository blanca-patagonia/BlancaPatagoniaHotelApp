/**
 * El valor si es uno de la lista, o `undefined`. Para validar lo que llega por
 * la URL o por un formulario contra una lista blanca.
 *
 * Reemplaza el patrón `(LISTA as readonly string[]).includes(x) ? (x as T) : …`,
 * que estaba repetido decenas de veces con dos casteos: si la lista y el tipo
 * se separaban, el compilador no lo veía. Acá el tipo sale de la lista misma.
 */
export function deLista<T extends string>(
  lista: readonly T[],
  valor: string | null | undefined,
): T | undefined {
  return valor != null && (lista as readonly string[]).includes(valor) ? (valor as T) : undefined
}

/**
 * Un embed de PostgREST como lista, venga como venga.
 *
 * Cuando la clave foránea es ÚNICA (una factura por reserva, 0045), PostgREST
 * devuelve un **objeto o `null`**, no un arreglo — aunque el tipo generado diga
 * arreglo —. Leerlo con `.length` o `[0]` da `undefined` o rompe: el tablero
 * entero tiraba `TypeError` con una reserva sin factura. Esto acepta las tres
 * formas.
 */
export function comoLista<T>(valor: T | T[] | null | undefined): T[] {
  if (Array.isArray(valor)) return valor
  return valor == null ? [] : [valor]
}
