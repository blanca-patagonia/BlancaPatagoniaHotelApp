/**
 * Mapeo manual de columnas de un informe importado.
 *
 * ── Por qué esto existe ─────────────────────────────────────────────────────
 *
 * El lector de informes adivina qué columna es cuál con un diccionario de alias
 * («Fecha de entrada», «Check-in», «Arrival»…). Funciona hasta que no funciona: el
 * extranet exporta en el idioma de la cuenta, las columnas cambian de nombre entre
 * versiones, y el hotel puede estar exportando desde una pantalla distinta a la que
 * se usó para escribir el diccionario.
 *
 * Cuando el diccionario no acierta, hoy la importación devuelve «no se reconocieron
 * las columnas» y ahí muere. Este módulo es la salida: que una persona diga qué
 * columna es cuál, **una sola vez por formato**, y quede guardado.
 *
 * ── La decisión que importa: por NOMBRE, no por posición ─────────────────────
 *
 * Las asignaciones se guardan como *campo → encabezado*, no como *campo → índice*.
 *
 * Si el extranet agrega una columna en el medio, un mapeo por índice queda corrido
 * **en silencio**: las fechas empiezan a leerse de la columna de importes y el
 * importador no falla, devuelve datos plausibles y equivocados. Es exactamente la
 * clase de error que este proyecto ya persiguió con las fechas `d/m/Y`.
 *
 * Por nombre, si la columna desaparece se detecta y se avisa. El índice se resuelve
 * en cada corrida contra los encabezados reales del archivo.
 */

/** Asignaciones de una persona: nombre del campo → encabezado normalizado. */
export type Asignaciones = Record<string, string>

/**
 * Huella de un formato de archivo, para reconocerlo la próxima vez.
 *
 * Son los encabezados normalizados, ordenados y unidos. Ordenados a propósito: si el
 * extranet reordena las columnas sin cambiar ninguna, sigue siendo el mismo formato y
 * el mapeo guardado sigue sirviendo —porque resuelve por nombre—. Con la huella sin
 * ordenar, un reordenamiento parecería un formato nuevo y volvería a preguntar.
 */
export function firmaEncabezados(
  encabezados: readonly string[],
  normalizar: (h: string) => string,
): string {
  return encabezados
    .map(normalizar)
    .filter((h) => h !== '')
    .sort()
    .join('|')
}

export interface ResolucionMapeo<C extends string> {
  /** Índice de cada campo en el archivo, o `null` si no se pudo ubicar. */
  indices: Record<C, number | null>
  /**
   * Campos que el mapeo guardado asignaba a una columna que **ya no está** en el
   * archivo.
   *
   * Se informan aparte de «no encontrado» porque significan algo distinto y más
   * accionable: el formato cambió y el mapeo quedó viejo. Sin esta distinción, el
   * usuario vería «faltan columnas» sobre un archivo que él mismo mapeó bien hace un
   * mes, y no tendría forma de saber que lo que hay que hacer es volver a mapear.
   */
  desaparecidas: { campo: C; encabezado: string }[]
}

/**
 * Resuelve los índices combinando la propuesta automática con el mapeo guardado.
 *
 * ── Quién gana ──────────────────────────────────────────────────────────────
 *
 * El **mapeo guardado**, cuando existe para ese campo. Es una afirmación de una
 * persona que miró el archivo; la propuesta es una heurística. Si alguien se tomó el
 * trabajo de decir «la columna “Ref” es el número de reserva», el diccionario no
 * tiene que discutirlo.
 *
 * El diccionario sigue cubriendo todo lo que el mapeo no menciona, así que guardar un
 * mapeo parcial —solo las columnas que la propuesta erró— es suficiente y es lo
 * normal.
 */
export function resolverIndices<C extends string>(
  propuesta: Record<C, number | null>,
  guardado: Asignaciones | null,
  encabezados: readonly string[],
  normalizar: (h: string) => string,
): ResolucionMapeo<C> {
  const indices = { ...propuesta }
  const desaparecidas: { campo: C; encabezado: string }[] = []

  if (!guardado) return { indices, desaparecidas }

  const normalizados = encabezados.map(normalizar)

  for (const [campo, encabezado] of Object.entries(guardado)) {
    // Un campo que ya no existe en el lector (porque se renombró) se ignora en vez de
    // ensuciar el resultado: el mapeo guardado puede ser más viejo que el código.
    if (!(campo in propuesta)) continue

    const idx = normalizados.indexOf(normalizar(encabezado))
    if (idx === -1) {
      desaparecidas.push({ campo: campo as C, encabezado })
      continue
    }
    indices[campo as C] = idx
  }

  return { indices, desaparecidas }
}

export interface ResultadoValidacion {
  ok: boolean
  /** Motivos en español, listos para mostrar. Vacío si `ok`. */
  motivos: string[]
  /** Solo las asignaciones que pasaron todas las comprobaciones. */
  limpias: Asignaciones
}

/**
 * Valida lo que llegó del formulario antes de guardarlo.
 *
 * ── Por qué hace falta validar esto y no confiar ────────────────────────────
 *
 * Las asignaciones se guardan como `jsonb`, y lo que llega es entrada libre de un
 * formulario. Sin validar, alguien podría guardar un campo inventado —que después el
 * lector ignora, así que el mapeo «se guarda» y no hace nada— o, peor, asignar una
 * columna de datos de tarjeta a un campo de texto libre.
 *
 * ⚠️ **La comprobación de columnas prohibidas es la razón principal de esta
 * función.** El mapeo manual le da al usuario exactamente la capacidad que el lector
 * le niega: elegir qué columna se lee. Si «Tarjeta virtual» se pudiera asignar a
 * `notas`, un PAN entraría a la base por la puerta de una pantalla de configuración,
 * que es justo lo que el contrato heredado de WinPAX prohíbe.
 */
export function validarAsignaciones(
  asignaciones: Asignaciones,
  camposValidos: readonly string[],
  encabezadosDelArchivo: readonly string[],
  esProhibida: (encabezado: string) => boolean,
  normalizar: (h: string) => string,
): ResultadoValidacion {
  const motivos: string[] = []
  const limpias: Asignaciones = {}
  const disponibles = new Set(encabezadosDelArchivo.map(normalizar))

  for (const [campo, encabezado] of Object.entries(asignaciones)) {
    // Vacío significa «no asignar», y es legítimo: no todos los campos están en todos
    // los archivos.
    if (!encabezado) continue

    if (!camposValidos.includes(campo)) {
      motivos.push(`«${campo}» no es un campo que el importador conozca.`)
      continue
    }

    if (esProhibida(encabezado)) {
      motivos.push(
        `La columna «${encabezado}» tiene datos que el sistema no guarda ` +
          `(tarjeta, código de seguridad, vencimiento). No se puede asignar a ningún campo.`,
      )
      continue
    }

    if (!disponibles.has(normalizar(encabezado))) {
      motivos.push(`La columna «${encabezado}» no está en el archivo.`)
      continue
    }

    limpias[campo] = normalizar(encabezado)
  }

  // Dos campos apuntando a la misma columna casi siempre es un error de quien mapeó,
  // y produce datos duplicados que después nadie entiende. Se avisa y no se guarda.
  const usadas = new Map<string, string>()
  for (const [campo, encabezado] of Object.entries(limpias)) {
    const yaLoUsa = usadas.get(encabezado)
    if (yaLoUsa) {
      motivos.push(
        `La columna «${encabezado}» está asignada a dos campos a la vez (${yaLoUsa} y ${campo}).`,
      )
      delete limpias[campo]
      continue
    }
    usadas.set(encabezado, campo)
  }

  return { ok: motivos.length === 0, motivos, limpias }
}

/**
 * Toma hasta `cuantos` valores de ejemplo de cada columna.
 *
 * ── Por qué la muestra es imprescindible y no un adorno ─────────────────────
 *
 * Quien tiene que mapear no necesariamente sabe qué significa cada encabezado del
 * export de su propia cuenta. Puede no reconocer «Ref», pero sí reconoce
 * `1234567890` como un número de reserva y `25/09/2026` como una fecha. Sin los
 * ejemplos, la pantalla le pide adivinar; con ellos, le pide leer.
 *
 * Se saltean las celdas vacías: una columna con dos huecos arriba mostraría dos
 * ejemplos en blanco, que es no mostrar nada.
 */
export function muestraDeColumnas(
  filas: readonly (readonly string[])[],
  cantidadColumnas: number,
  cuantos = 3,
): string[][] {
  const muestra: string[][] = Array.from({ length: cantidadColumnas }, () => [])

  // Se arranca en 1: la fila 0 son los encabezados.
  for (let f = 1; f < filas.length; f++) {
    for (let c = 0; c < cantidadColumnas; c++) {
      if (muestra[c].length >= cuantos) continue
      const valor = (filas[f][c] ?? '').trim()
      if (valor) muestra[c].push(valor.slice(0, 40))
    }
  }

  return muestra
}
