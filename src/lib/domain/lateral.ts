/**
 * Ancho ajustable del menú lateral.
 *
 * ── Por qué hay límites y no un arrastre libre ──────────────────────────────
 *
 * Sin tope, el menú se puede arrastrar hasta tapar la pantalla o hasta dejarlo
 * en dos píxeles. Lo segundo es lo grave: la barra queda inutilizable **y sin
 * nada de qué agarrarla para recuperarla**, así que quien lo hace sin querer se
 * queda sin navegación hasta que alguien le explique que existe un doble clic
 * para restaurarla. Un mínimo que siempre deje ver los enlaces convierte ese
 * error en algo del que se vuelve solo.
 *
 * Los valores salen del contenido, no de un número redondo:
 *
 * · **Mínimo 200 px** — «Servicio de cocina» y «Objetos perdidos» son las
 *   etiquetas más largas del menú; con el ícono y los márgenes, por debajo de
 *   esto empiezan a cortarse.
 * · **Máximo 420 px** — más que eso no mejora nada (ninguna etiqueta lo
 *   necesita) y le come ancho a la pantalla de trabajo, que es donde viven las
 *   tablas anchas de reservas y la grilla de ocupación.
 * · **Por defecto 240 px** — el ancho con el que se diseñó el panel (`w-60`).
 */

export const ANCHO_MINIMO = 200
export const ANCHO_MAXIMO = 420
export const ANCHO_POR_DEFECTO = 240

/** Cuánto se mueve el menú con cada flecha del teclado. */
export const PASO_TECLADO = 16

/** Dónde se recuerda la preferencia de cada persona, en su propio navegador. */
export const CLAVE_ANCHO = 'bp:ancho-menu'

/**
 * Encierra un ancho dentro de los límites.
 *
 * Descarta además lo que no es un número: el valor viene de `localStorage`, que
 * devuelve texto y puede estar vacío, corrupto o escrito a mano desde las
 * herramientas del navegador. Un `NaN` acá se convertiría en una barra sin ancho
 * y, otra vez, sin nada de qué agarrarla.
 */
export function acotarAncho(valor: number): number {
  if (!Number.isFinite(valor)) return ANCHO_POR_DEFECTO
  return Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, Math.round(valor)))
}

/** Interpreta lo guardado en el navegador. Si no sirve, vuelve al valor de diseño. */
export function leerAnchoGuardado(crudo: string | null): number {
  /*
    ⚠️ La cadena vacía se descarta ANTES de convertir, y no es un detalle:
    `Number('')` es **0**, no `NaN`. Sin esta línea, una clave vacía —que es lo
    que deja `localStorage.setItem(clave, '')` o una escritura interrumpida— no
    caía en el valor de diseño sino que se acotaba al mínimo, y el menú aparecía
    angosto sin que nadie lo hubiera tocado. Lo mismo con los espacios: `Number('  ')`
    también da 0.
  */
  if (crudo === null || crudo.trim() === '') return ANCHO_POR_DEFECTO
  return acotarAncho(Number(crudo))
}
