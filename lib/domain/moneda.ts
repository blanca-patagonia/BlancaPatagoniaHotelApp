/**
 * Formateo de importes para mostrar en pantalla.
 *
 * Por qué existe. Todo el sistema venía escribiendo los importes con
 * `monto.toLocaleString('es-AR')` repetido en cada pantalla. Ese formato usa,
 * por defecto, **entre 0 y 3 decimales**, así que un mismo listado publica:
 *
 *     120      →  «USD 120»
 *     145.2    →  «USD 145,2»      ← la tarifa base más IVA
 *     168.19   →  «USD 168,19»
 *
 * En una columna de precios eso se lee como tres formatos distintos, y «145,2»
 * directamente parece un número cortado. Un importe siempre lleva sus dos
 * decimales: es la convención de cualquier factura, y acá además el número sale
 * de multiplicar por el IVA, así que los decimales aparecen casi siempre.
 *
 * Se aplica en el portal público, que es el que ve el huésped. El panel repite
 * el mismo `toLocaleString` en unos 30 lugares más; migrarlos es mecánico y
 * queda anotado, pero no se hace de paso para no mezclarlo con un cambio de
 * interfaz.
 */

/*
  Separadores por idioma
  ----------------------
  ⚠️ Esto estaba fijo en `es-AR`, y con el portal en un solo idioma no se
  notaba. Con cinco sí: `es-AR` escribe «USD 1.234,56», y quien lee en inglés
  entiende **mil doscientos treinta y cuatro coma cincuenta y seis** como
  «1,234.56» — o peor, lee «145,20» como catorce mil quinientos veinte. Un
  separador decimal equivocado no se ve como un error de formato: se ve como
  otro precio.

  Los formateadores se memorizan porque construir un `Intl.NumberFormat` no es
  gratis y estos se llaman una vez por fila de una lista de precios.
*/
const FORMATOS = new Map<string, Intl.NumberFormat>()

function formatoDe(etiqueta: string): Intl.NumberFormat {
  let f = FORMATOS.get(etiqueta)
  if (!f) {
    f = new Intl.NumberFormat(etiqueta, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    FORMATOS.set(etiqueta, f)
  }
  return f
}

/**
 * Etiqueta por omisión.
 *
 * Sigue siendo `es-AR` para que el panel —que no se traduce— no cambie de
 * aspecto, y para que cualquier llamada que todavía no pase idioma siga
 * funcionando igual que antes.
 */
const ETIQUETA_POR_OMISION = 'es-AR'

/**
 * Importe sin moneda: `145,20`.
 *
 * Un valor no finito (un `NaN` que se coló de un `Number()` sobre `null`) se
 * muestra como `0,00` en vez de propagar «NaN» a la pantalla del huésped.
 */
export function importe(monto: number, etiqueta: string = ETIQUETA_POR_OMISION): string {
  return formatoDe(etiqueta).format(Number.isFinite(monto) ? monto : 0)
}

/**
 * Importe con moneda: `USD 145,20` en español, `USD 145.20` en inglés.
 *
 * El código `USD` va delante y no se traduce: es ISO 4217 y se entiende igual
 * en los cinco idiomas. Lo que cambia es el separador decimal.
 */
export function formatearUSD(monto: number, etiqueta: string = ETIQUETA_POR_OMISION): string {
  return `USD ${importe(monto, etiqueta)}`
}

/**
 * Precio medio por noche de una estadía.
 *
 * Es un **promedio**, no el precio de una noche puntual: una estadía puede
 * cruzar temporadas y entonces cada noche vale distinto. Se usa para el «por
 * noche» de las tarjetas de resultado, donde el dato que decide es el total;
 * el desglose noche por noche va en el checkout, que es donde se paga.
 */
export function porNoche(total: number, noches: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(noches) || noches <= 0) return 0
  return Math.round((total / noches + Number.EPSILON) * 100) / 100
}
