import 'server-only'

/**
 * Lectura completa de una tabla, por encima del techo de PostgREST.
 *
 * Por qué existe. `supabase/config.toml` fija `max_rows = 1000`: **toda**
 * consulta devuelve como mucho mil filas, sin error y sin ninguna señal de que
 * hubo recorte. Eso convierte dos cosas en mentiras silenciosas:
 *
 *  · La exportación a CSV declaraba `MAX_FILAS = 5000` y entregaba 1000. Quien
 *    descarga el archivo no tiene forma de notar que le faltan filas.
 *  · Los reportes gerenciales agregan en JavaScript sobre tablas enteras: con el
 *    corte, la ocupación, el ADR y el RevPAR quedan mal desde que cualquiera de
 *    esas tablas pasa las mil filas. Un KPI equivocado es peor que ninguno,
 *    porque se usa para decidir.
 *
 * La solución correcta a largo plazo es agregar en SQL y no traerse las filas.
 * Mientras tanto, esto al menos hace que el recorte **no sea silencioso**.
 */

/** Tamaño de cada tramo. Coincide con `max_rows`: pedir más no traería más. */
const TRAMO = 1000

/**
 * Techo duro de seguridad.
 *
 * Sin un límite, un error de filtro sobre una tabla que creció convierte una
 * pantalla en una descarga de memoria hasta tumbar el proceso. Al llegar acá se
 * corta, pero **avisando**, que es la diferencia con el comportamiento anterior.
 */
const TECHO = 50_000

/** Lo mínimo que se necesita de la respuesta de supabase-js. */
type Respuesta<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export interface ResultadoCompleto<T> {
  filas: T[]
  /** `true` si se llegó al techo y quedaron filas sin traer. */
  truncado: boolean
  /** Motivo del fallo, si la base cortó a mitad de camino. */
  error: string | null
}

/**
 * Trae todas las filas de una consulta, en tramos de mil.
 *
 * `armar` recibe el rango y devuelve la consulta ya construida. Se pasa como
 * función porque una consulta de supabase-js no se puede reutilizar entre
 * llamadas: cada `range` necesita su propio objeto.
 *
 *     const { filas, truncado } = await traerTodo((desde, hasta) =>
 *       supabase.from('estadias').select('*').order('id').range(desde, hasta),
 *     )
 *
 * ⚠️ La consulta **debe traer un `order` estable**. Sin orden garantizado,
 * Postgres puede devolver la misma fila en dos tramos y omitir otra.
 */
export async function traerTodo<T>(
  armar: (desde: number, hasta: number) => Respuesta<T>,
  techo: number = TECHO,
): Promise<ResultadoCompleto<T>> {
  const filas: T[] = []

  for (let desde = 0; desde < techo; desde += TRAMO) {
    const hasta = Math.min(desde + TRAMO, techo) - 1
    const { data, error } = await armar(desde, hasta)

    if (error) return { filas, truncado: true, error: error.message }

    const tramo = data ?? []
    filas.push(...tramo)

    // Un tramo incompleto significa que no hay más filas.
    if (tramo.length < TRAMO) return { filas, truncado: false, error: null }
  }

  return { filas, truncado: true, error: null }
}
