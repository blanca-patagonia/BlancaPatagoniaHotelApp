/**
 * Lector del extracto bancario en CSV / Excel exportado a CSV.
 *
 * Lógica **pura**: recibe el texto del archivo y devuelve movimientos
 * normalizados. No conoce la base ni la red.
 *
 * ── Por qué es un archivo y no una API ──────────────────────────────────────
 *
 * **Santander Argentina no publica una API de banca abierta para clientes.** No
 * hay «Open Banking» obligatorio en Argentina como en Brasil o el Reino Unido, y
 * el Home Banking de empresas exporta el extracto en CSV, XLS y PDF. La forma
 * disponible de traer el movimiento de la cuenta al sistema es que alguien baje
 * ese archivo y lo suba, y eso es lo que hace este importador.
 *
 * No se inventa un endpoint ni se automatiza con las credenciales del hotel: meter
 * la clave del home banking en el sistema para raspar la web sería a la vez una
 * violación de los términos del banco y el peor secreto que este proyecto podría
 * guardar. Cuando el hotel contrate un servicio de agregación bancaria con API
 * (o el banco publique una), el puerto `ExtractoProvider` ya está para enchufarlo.
 *
 * ── Los tres problemas reales de este formato ───────────────────────────────
 *
 * 1. **La tabla no empieza en la primera línea.** El export del banco trae dos o
 *    tres filas de encabezado con el nombre del titular, el número de cuenta y el
 *    período. Un lector que asuma que la fila 1 son los encabezados no encuentra
 *    ninguna columna y devuelve cero movimientos **sin fallar**.
 * 2. **Hay dos formatos de importe.** Algunos extractos traen una columna
 *    `Importe` con signo y otros dos columnas, `Débito` y `Crédito`, siempre en
 *    positivo. Leer el segundo como si fuera el primero convierte todos los gastos
 *    en ingresos: el mes cierra al revés.
 * 3. **Los números vienen en formato local.** `1.234,56` leído como anglosajón da
 *    `1.23456`. Se reusa `interpretarImporte`, que ya resuelve las dos formas.
 */

import { partirCsv, normalizarEncabezado, interpretarFecha, interpretarImporte } from '@/lib/canales/csv'
import { conClaves, type MovimientoExterno, type OrigenMovimiento } from '@/lib/domain/conciliacion'

/* ───────────────────────────────────────────────────────── encabezados ──── */

export type CampoExtracto = 'fecha' | 'descripcion' | 'importe' | 'debito' | 'credito' | 'referencia'

/**
 * Nombres con los que cada campo aparece, ya normalizados.
 *
 * El orden importa: se toma la primera coincidencia, así que `fecha valor` va
 * antes que `fecha` o el segundo se quedaría con la columna equivocada en los
 * extractos que traen las dos (fecha de operación y fecha de acreditación).
 */
const ALIAS: Record<CampoExtracto, readonly string[]> = {
  fecha: ['fecha', 'fecha operacion', 'fecha de operacion', 'fecha movimiento', 'date'],
  descripcion: [
    'descripcion',
    'concepto',
    'detalle',
    'movimiento',
    'referencia descripcion',
    'description',
  ],
  importe: ['importe', 'monto', 'amount'],
  debito: ['debito', 'debitos', 'cargo', 'debit'],
  credito: ['credito', 'creditos', 'abono', 'credit'],
  referencia: ['referencia', 'nro operacion', 'numero de operacion', 'comprobante', 'id'],
}

function indiceDe(encabezados: readonly string[], campo: CampoExtracto): number | null {
  const normalizados = encabezados.map(normalizarEncabezado)
  for (const alias of ALIAS[campo]) {
    const i = normalizados.indexOf(alias)
    if (i !== -1) return i
  }
  // Segunda pasada, por inclusión: «fecha de la operación» no coincide exacto con
  // ningún alias pero contiene «fecha».
  for (const alias of ALIAS[campo]) {
    const i = normalizados.findIndex((h) => h.includes(alias))
    if (i !== -1) return i
  }
  return null
}

export interface MapaExtracto {
  fecha: number
  descripcion: number | null
  importe: number | null
  debito: number | null
  credito: number | null
  referencia: number | null
}

/**
 * Busca la fila de encabezados dentro de las primeras del archivo.
 *
 * Se recorre hasta `MAX_FILAS_PREAMBULO` porque el export del banco antepone el
 * titular, la cuenta y el período. Se acepta la primera fila que tenga **fecha**
 * y alguna forma de importe: sin esas dos no hay movimiento que leer.
 *
 * Devuelve `null` si ninguna sirve. No adivina: un archivo que no se entiende se
 * rechaza con un mensaje, en vez de importar cero filas y decir «listo».
 */
export const MAX_FILAS_PREAMBULO = 12

export function ubicarEncabezados(
  filas: readonly string[][],
): { fila: number; mapa: MapaExtracto } | null {
  const hasta = Math.min(filas.length, MAX_FILAS_PREAMBULO)

  for (let i = 0; i < hasta; i++) {
    const encabezados = filas[i]
    const fecha = indiceDe(encabezados, 'fecha')
    if (fecha === null) continue

    const importe = indiceDe(encabezados, 'importe')
    const debito = indiceDe(encabezados, 'debito')
    const credito = indiceDe(encabezados, 'credito')
    if (importe === null && debito === null && credito === null) continue

    return {
      fila: i,
      mapa: {
        fecha,
        descripcion: indiceDe(encabezados, 'descripcion'),
        importe,
        debito,
        credito,
        referencia: indiceDe(encabezados, 'referencia'),
      },
    }
  }

  return null
}

/* ─────────────────────────────────────────────────────────── el importe ──── */

/**
 * Resuelve el importe **con signo** de una fila.
 *
 * Las tres formas que traen los extractos, en orden de prioridad:
 *
 * 1. Columnas `Débito` / `Crédito` separadas, ambas en positivo. El débito sale de
 *    la cuenta, así que va en negativo. Se miran **primero**: cuando el archivo
 *    trae las tres columnas, éstas son las que llevan el signo bien.
 * 2. Una columna `Importe` con signo propio.
 * 3. Nada legible → `null`, y la fila se descarta con su motivo.
 */
export function importeConSigno(fila: readonly string[], mapa: MapaExtracto): number | null {
  if (mapa.debito !== null || mapa.credito !== null) {
    const debito = mapa.debito === null ? null : interpretarImporte(fila[mapa.debito] ?? '')
    const credito = mapa.credito === null ? null : interpretarImporte(fila[mapa.credito] ?? '')

    // El banco deja en blanco o en cero la columna que no aplica.
    if (credito !== null && credito !== 0) return Math.abs(credito)
    if (debito !== null && debito !== 0) return -Math.abs(debito)
    return null
  }

  if (mapa.importe !== null) {
    const n = interpretarImporte(fila[mapa.importe] ?? '')
    return n === null || n === 0 ? null : n
  }

  return null
}

/* ─────────────────────────────────────────────────────────── el lector ──── */

export interface FilaDescartada {
  /**
   * Posición de la fila en el archivo, contando desde 1 y **sin contar las líneas
   * en blanco**.
   *
   * ⚠️ No se promete que sea el número de línea de Excel, y la diferencia importa:
   * `partirCsv` descarta las filas totalmente vacías —Excel deja una al final casi
   * siempre—, así que una línea en blanco en el medio del archivo correría la
   * numeración. Decir «línea 42» cuando en Excel es la 43 manda a alguien a mirar
   * la fila equivocada, que es peor que no dar el número.
   */
  fila: number
  motivo: string
}

export interface ResultadoExtracto {
  movimientos: MovimientoExterno[]
  descartadas: FilaDescartada[]
  /** `true` si alguna fecha vino en formato ambiguo (`03/04/2026`). */
  fechasAmbiguas: boolean
  /** Motivo por el que no se pudo leer nada. `null` si se leyó bien. */
  error: string | null
}

export interface OpcionesExtracto {
  origen?: OrigenMovimiento
  cuenta?: string | null
  /** Moneda de la cuenta. El extracto casi nunca la trae en cada fila. */
  moneda?: string
}

/**
 * Lee un extracto bancario completo.
 *
 * **Nunca lanza.** Un archivo raro es lo normal acá, y una excepción en un import
 * deja a quien lo subió sin saber qué pasó. Los problemas vuelven en
 * `error` (no se pudo leer nada) o en `descartadas` (se leyó, con filas afuera).
 *
 * ⚠️ La moneda **no se deduce del archivo**: el extracto de una caja de ahorro en
 * pesos y el de una en dólares son idénticos salvo por el encabezado del banco.
 * La elige quien importa, y por eso `moneda` es un parámetro y no una heurística.
 * Adivinarla mal sumaría dólares como pesos en el resumen del mes.
 */
export function leerExtracto(texto: string, opciones: OpcionesExtracto = {}): ResultadoExtracto {
  const origen = opciones.origen ?? 'banco'
  const moneda = opciones.moneda ?? 'ARS'
  const vacio: ResultadoExtracto = {
    movimientos: [],
    descartadas: [],
    fechasAmbiguas: false,
    error: null,
  }

  const filas = partirCsv(texto)
  if (filas.length === 0) {
    return { ...vacio, error: 'El archivo está vacío.' }
  }

  const ubicacion = ubicarEncabezados(filas)
  if (!ubicacion) {
    return {
      ...vacio,
      error:
        'No se encontraron las columnas del extracto. Hacen falta al menos una de fecha y una de importe (o débito y crédito).',
    }
  }

  const { fila: filaEncabezados, mapa } = ubicacion
  const descartadas: FilaDescartada[] = []
  const sinClave: Omit<MovimientoExterno, 'externalId'>[] = []
  const referencias: (string | null)[] = []
  let fechasAmbiguas = false

  for (let i = filaEncabezados + 1; i < filas.length; i++) {
    const fila = filas[i]
    const numero = i + 1

    const fecha = interpretarFecha(fila[mapa.fecha] ?? '')
    if (!fecha) {
      /*
        Las filas de totales del final del extracto caen acá, y no son un error:
        «SALDO AL 30/09» no tiene fecha en la columna de fecha. Se descartan con
        su motivo igual, para que el número de importadas y el de líneas del
        archivo se puedan comparar sin sorpresas.
      */
      descartadas.push({ fila: numero, motivo: 'La fecha no se pudo interpretar.' })
      continue
    }
    if (fecha.ambigua) fechasAmbiguas = true

    const monto = importeConSigno(fila, mapa)
    if (monto === null) {
      descartadas.push({ fila: numero, motivo: 'El importe está vacío o no se pudo interpretar.' })
      continue
    }

    sinClave.push({
      origen,
      cuenta: opciones.cuenta ?? null,
      fecha: fecha.iso,
      descripcion: (mapa.descripcion === null ? '' : (fila[mapa.descripcion] ?? '')).trim(),
      monto,
      moneda,
    })
    referencias.push(mapa.referencia === null ? null : (fila[mapa.referencia] ?? '').trim() || null)
  }

  return {
    movimientos: conClaves(sinClave, referencias),
    descartadas,
    fechasAmbiguas,
    error: null,
  }
}
