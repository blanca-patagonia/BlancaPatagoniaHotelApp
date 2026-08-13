/**
 * Utilidades comunes a todos los listados del panel: paginación, búsqueda y
 * armado de enlaces que conservan los filtros vigentes.
 *
 * Antes cada pantalla cortaba con un `.limit(100)` fijo: si el hotel superaba
 * ese número, las filas sobrantes desaparecían sin ningún aviso al usuario.
 */

export const TAMANIO_PAGINA = 25

export interface Rango {
  /** Índice inicial (inclusive) para `.range()` de PostgREST. */
  desde: number
  /** Índice final (inclusive) para `.range()` de PostgREST. */
  hasta: number
}

/** Normaliza el parámetro `?pagina=` a un entero válido (base 1). */
export function paginaActual(crudo: string | undefined): number {
  const n = Number(crudo)
  if (!Number.isInteger(n) || n < 1) return 1
  return n
}

/** Convierte un número de página en el rango que espera PostgREST. */
export function rangoDePagina(pagina: number, tamanio: number = TAMANIO_PAGINA): Rango {
  const inicio = (Math.max(1, pagina) - 1) * tamanio
  return { desde: inicio, hasta: inicio + tamanio - 1 }
}

/** Cantidad total de páginas para un total de filas dado (mínimo 1). */
export function totalPaginas(total: number, tamanio: number = TAMANIO_PAGINA): number {
  if (total <= 0) return 1
  return Math.ceil(total / tamanio)
}

/**
 * Texto del tipo «26–50 de 214» que se muestra junto a los controles de página.
 */
export function resumenRango(
  pagina: number,
  total: number,
  tamanio: number = TAMANIO_PAGINA,
): string {
  if (total === 0) return '0 resultados'
  const desde = (pagina - 1) * tamanio + 1
  const hasta = Math.min(pagina * tamanio, total)
  return `${desde}–${hasta} de ${total}`
}

/**
 * Arma un querystring a partir de los filtros actuales aplicando cambios.
 *
 * Un valor `undefined` o vacío quita el parámetro, de modo que las URLs quedan
 * limpias (`/panel/reservas` en lugar de `/panel/reservas?q=&estado=`).
 */
export function construirQuery(
  actuales: Record<string, string | undefined>,
  cambios: Record<string, string | number | undefined> = {},
): string {
  const params = new URLSearchParams()
  const combinados: Record<string, string | number | undefined> = { ...actuales, ...cambios }

  for (const clave of Object.keys(combinados).sort()) {
    const valor = combinados[clave]
    if (valor === undefined || valor === '') continue
    params.set(clave, String(valor))
  }
  const texto = params.toString()
  return texto ? `?${texto}` : ''
}

/**
 * Prepara un término para el operador `ilike` de PostgREST.
 *
 * Escapa los comodines `%` y `_` para que una búsqueda literal de "100%" no
 * termine devolviendo la tabla entera, y descarta términos vacíos.
 */
export function terminoBusqueda(crudo: string | undefined): string | null {
  const limpio = (crudo ?? '').trim()
  if (!limpio) return null
  return limpio.replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/**
 * Envuelve un patrón `ilike` para usarlo **dentro de la lista de condiciones de
 * `.or()`**.
 *
 * ⚠️ En `or=(…)` la **coma separa condiciones** y los paréntesis agrupan. Si el
 * término del usuario se interpola pelado, una coma parte la expresión y agrega
 * condiciones que nadie pidió: buscar `x,id.gt.0` deja de ser una búsqueda y
 * pasa a ser un filtro elegido por quien escribe.
 *
 * Escapar `%` y `_` no alcanza: esos son los comodines de LIKE, no la sintaxis
 * del filtro. Son dos capas distintas y hay que atravesar las dos.
 *
 * PostgREST admite valores **entre comillas dobles** justamente para valores con
 * caracteres reservados. Dentro de las comillas hay que escapar `\` y `"`, que
 * es lo único que puede cerrarlas antes de tiempo.
 *
 * Recibe el término **ya escapado para LIKE** (lo que devuelve
 * `terminoBusqueda`), y le agrega solo la capa de PostgREST. Así cada función
 * hace una cosa y no se escapa dos veces lo mismo: un `%` literal llega como
 * `\\%` dentro de las comillas, PostgREST lo desescapa a `\%` y LIKE lo lee
 * como un porcentaje literal.
 */
export function patronOr(termino: string): string {
  const escapado = termino.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `"%${escapado}%"`
}
