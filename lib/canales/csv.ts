/**
 * Lector del «Informe de reservas» que exporta el extranet de Booking.com.
 *
 * Lógica **pura**: recibe el texto del archivo y devuelve reservas normalizadas
 * al lenguaje del dominio. No conoce la base ni la red, así que todos sus bordes
 * —que son muchos— se prueban sin levantar nada.
 *
 * ── Por qué este camino existe ──────────────────────────────────────────────
 *
 * Booking.com no tiene API abierta. Las tres opciones reales son: la Connectivity
 * API (requiere ser partner certificado, inalcanzable para un hotel solo), un
 * channel manager (la vía de producción, pero es una contratación del hotel), o
 * bajar el informe del extranet y leerlo. Esta es la tercera: no necesita permiso
 * de nadie y trae bastante más que el iCal —importes, comisión, estado, contacto—.
 *
 * ⚠️ Es de **solo lectura**. No le empuja disponibilidad a Booking, así que **no
 * evita el overbooking**. Ver el ADR 0021.
 *
 * ── Los tres problemas reales de este archivo ───────────────────────────────
 *
 * 1. **El separador no siempre es una coma.** Excel en configuración regional
 *    española exporta con punto y coma. Un lector que asuma coma mete la fila
 *    entera en la primera columna y no falla: devuelve datos vacíos.
 * 2. **Los encabezados cambian según el idioma del extranet.** «Fecha de entrada»,
 *    «Check-in», «Arrival»… y con o sin acentos según quién exportó.
 * 3. **Las fechas vienen en cualquier orden.** `2026-09-10`, `10/09/2026`,
 *    `09/10/2026`. Confundir día con mes da una reserva plausible en la fecha
 *    equivocada, que es el peor error posible acá.
 */

import type { CanalVenta, ReservaDeCanal } from '.'
import { interpretarModalidadCobro } from '@/lib/domain/canales-cobro'
import { muestraDeColumnas, resolverIndices } from '@/lib/domain/mapeo-columnas'

/* ─────────────────────────────────────────────────────── partir el texto ──── */

/**
 * Detecta el separador de columnas.
 *
 * Se cuenta cuál aparece más veces **fuera de comillas** en la primera línea. No
 * alcanza con contar a secas: un encabezado como `"Apellido, Nombre"` tiene una
 * coma que no separa nada, y en un archivo con punto y coma esa coma sola podría
 * ganar la votación.
 */
export function detectarDelimitador(primeraLinea: string): string {
  const candidatos = [';', ',', '\t']
  let mejor = ','
  let maximo = -1

  for (const d of candidatos) {
    let cuenta = 0
    let enComillas = false
    for (let i = 0; i < primeraLinea.length; i++) {
      const c = primeraLinea[i]
      if (c === '"') enComillas = !enComillas
      else if (c === d && !enComillas) cuenta++
    }
    if (cuenta > maximo) {
      maximo = cuenta
      mejor = d
    }
  }

  return mejor
}

/**
 * Parte un CSV en filas y celdas.
 *
 * Implementa lo que hace falta de RFC 4180: campos entre comillas, comillas
 * escapadas por duplicación (`""`), y saltos de línea **dentro** de un campo
 * entrecomillado —que es lo que pasa con el campo de observaciones cuando el
 * huésped escribió dos renglones—.
 *
 * Se saca el BOM de UTF-8 si está: Excel lo agrega, y sin quitarlo el primer
 * encabezado no coincide con nada y el archivo entero parece no tener columnas.
 */
export function partirCsv(texto: string, delimitador?: string): string[][] {
  const limpio = texto.replace(/^﻿/, '')
  if (!limpio.trim()) return []

  const primeraLinea = limpio.split(/\r?\n/, 1)[0] ?? ''
  const d = delimitador ?? detectarDelimitador(primeraLinea)

  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let enComillas = false

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]

    if (enComillas) {
      if (c === '"') {
        // Dos comillas seguidas son una comilla literal, no el cierre.
        if (limpio[i + 1] === '"') {
          celda += '"'
          i++
        } else {
          enComillas = false
        }
      } else {
        celda += c
      }
      continue
    }

    if (c === '"') {
      enComillas = true
    } else if (c === d) {
      fila.push(celda)
      celda = ''
    } else if (c === '\n') {
      fila.push(celda)
      filas.push(fila)
      fila = []
      celda = ''
    } else if (c === '\r') {
      // Se ignora: el `\n` que sigue cierra la fila. Un `\r` solitario (Mac
      // clásico) es tan raro hoy que no vale la pena la ambigüedad.
    } else {
      celda += c
    }
  }

  // Última fila, si el archivo no termina en salto de línea.
  if (celda !== '' || fila.length > 0) {
    fila.push(celda)
    filas.push(fila)
  }

  // Se descartan las filas totalmente vacías: Excel deja una al final casi siempre.
  return filas.filter((f) => f.some((c) => c.trim() !== ''))
}

/* ──────────────────────────────────────────────────────── encabezados ──── */

/**
 * Normaliza un encabezado para poder compararlo.
 *
 * Saca acentos, pasa a minúsculas y colapsa todo lo que no sea letra o número.
 * Así «Fecha de entrada», «FECHA DE ENTRADA» y «Fecha  de  Entrada:» son lo mismo.
 */
export function normalizarEncabezado(h: string): string {
  return h
    .normalize('NFD')
    // Marcas diacríticas combinantes, por punto de código para que el archivo
    // fuente no dependa de cómo se guardó su codificación.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Columnas que el importador **no lee nunca**, ni siquiera para mostrarlas.
 *
 * ── Por qué esto existe y por qué va acá y no en la pantalla ────────────────
 *
 * WinPAX guardaba número de tarjeta, vencimiento y PIN en texto plano. Este sistema
 * no puede empezar a hacerlo, y menos por la puerta de atrás de una importación.
 * Hay un test que lo fija como contrato.
 *
 * Hoy el informe de Booking no exporta datos de tarjeta, así que esto parece
 * innecesario. Deja de parecerlo con el **mapeo manual de columnas**: en cuanto la
 * pantalla le ofrezca al usuario elegir qué columna es cuál, alguien va a poder
 * asignar «Tarjeta virtual» al campo de observaciones y meter un PAN en la base sin
 * darse cuenta. Por eso la guarda vive en el lector —el único lugar por el que pasan
 * todos los caminos— y no en el formulario.
 *
 * Una columna que matchea esto no se mapea, no se muestrea y no se ofrece: es como si
 * no estuviera en el archivo.
 */
export const COLUMNAS_PROHIBIDAS =
  /tarjeta|card|cvc|cvv|iban|\bpan\b|caducidad|expiry|titular de la tarjeta|cardholder/

/** ¿Este encabezado trae datos que no se pueden guardar? */
export function esColumnaProhibida(encabezado: string): boolean {
  return COLUMNAS_PROHIBIDAS.test(normalizarEncabezado(encabezado))
}

/** Campos que el importador necesita encontrar. */
export type CampoBooking =
  | 'externalId'
  | 'huesped'
  | 'checkIn'
  | 'checkOut'
  | 'estado'
  | 'personas'
  | 'tipoUnidad'
  | 'importe'
  | 'moneda'
  | 'comision'
  | 'email'
  | 'telefono'
  | 'pais'
  | 'notas'
  | 'reservadaEn'
  | 'modalidadCobro'

/**
 * Nombres con los que cada campo puede aparecer.
 *
 * Se incluyen las variantes en español y en inglés porque el extranet exporta en
 * el idioma de la cuenta, y quien baja el archivo no siempre es el mismo. Están
 * ya normalizados con `normalizarEncabezado`.
 *
 * El orden importa: se toma la **primera** coincidencia, así que las variantes
 * más específicas van antes. `numero de reserva` antes que `reserva`, o el
 * segundo capturaría también «Fecha de reserva».
 */
/**
 * Todos los campos que el lector conoce, como lista.
 *
 * La pantalla de mapeo manual la recorre para ofrecer una fila por campo, y la
 * validación la usa como **lista cerrada**: una clave que no esté acá se rechaza, en
 * vez de guardarse y después no hacer nada —que es el peor resultado, porque el
 * usuario cree que mapeó algo—.
 */
export const CAMPOS_BOOKING: readonly CampoBooking[] = [
  'externalId', 'huesped', 'checkIn', 'checkOut', 'estado', 'personas', 'tipoUnidad',
  'importe', 'moneda', 'comision', 'email', 'telefono', 'pais', 'notas', 'reservadaEn',
  'modalidadCobro',
]

/** Nombre en español de cada campo, para la pantalla de mapeo. */
export const ETIQUETAS_CAMPO: Record<CampoBooking, string> = {
  externalId: 'Número de reserva',
  huesped: 'Nombre del huésped',
  checkIn: 'Fecha de entrada',
  checkOut: 'Fecha de salida',
  estado: 'Estado de la reserva',
  personas: 'Cantidad de personas',
  tipoUnidad: 'Tipo de unidad',
  importe: 'Importe',
  moneda: 'Moneda',
  comision: 'Comisión del canal',
  email: 'Correo electrónico',
  telefono: 'Teléfono',
  pais: 'País',
  notas: 'Observaciones',
  reservadaEn: 'Fecha en que reservó',
  modalidadCobro: 'Quién cobra',
}

const ALIAS: Record<CampoBooking, readonly string[]> = {
  externalId: ['numero de reserva', 'n de reserva', 'id de reserva', 'book number', 'reservation number', 'booking number'],
  huesped: ['nombre del cliente', 'nombre del huesped', 'cliente', 'huesped', 'guest name', 'guest'],
  checkIn: ['fecha de entrada', 'entrada', 'llegada', 'check in', 'checkin', 'arrival'],
  checkOut: ['fecha de salida', 'salida', 'check out', 'checkout', 'departure'],
  estado: ['estado', 'status'],
  personas: ['personas', 'huespedes', 'pax', 'adultos', 'guests', 'persons', 'occupancy'],
  tipoUnidad: ['tipo de unidad', 'tipo de habitacion', 'habitacion', 'unit type', 'room type', 'room'],
  importe: ['precio', 'importe', 'total', 'price', 'amount'],
  moneda: ['divisa', 'moneda', 'currency'],
  comision: ['comision', 'commission'],
  email: ['direccion de correo electronico', 'correo electronico', 'email', 'e mail'],
  telefono: ['telefono', 'phone', 'phone number'],
  pais: ['pais', 'country'],
  notas: ['observaciones', 'comentarios', 'peticiones especiales', 'remarks', 'notes', 'special requests'],
  reservadaEn: ['fecha de reserva', 'reservado el', 'booked on', 'booked date'],
  // Quién cobra: el hotel en el mostrador, o el canal y después transfiere. En este
  // hotel conviven las dos, así que el dato decide si hay algo que cobrar al salir.
  modalidadCobro: ['forma de pago', 'tipo de pago', 'metodo de pago', 'modalidad de pago', 'payment type', 'payment method', 'payment'],
}

/**
 * Ubica cada campo en la fila de encabezados.
 *
 * Devuelve `null` para los que no encontró. Sólo cuatro son obligatorios (ver
 * `CAMPOS_OBLIGATORIOS`); el resto puede faltar sin que el archivo sea inservible.
 */
export function mapearColumnas(encabezados: readonly string[]): Record<CampoBooking, number | null> {
  /*
    Las columnas prohibidas se ponen en blanco ANTES de buscar, no se filtran de la
    lista: los índices tienen que seguir alineados con las celdas del archivo. Si se
    quitaran, todas las columnas posteriores quedarían corridas un lugar — el error
    silencioso más caro que puede tener este lector.

    Con el encabezado vacío, ningún alias coincide, así que la columna se vuelve
    invisible para el mapeo sin mover a las demás.
  */
  const normalizados = encabezados.map((h) => (esColumnaProhibida(h) ? '' : normalizarEncabezado(h)))
  const mapa = {} as Record<CampoBooking, number | null>

  for (const campo of Object.keys(ALIAS) as CampoBooking[]) {
    mapa[campo] = null
    for (const alias of ALIAS[campo]) {
      // Coincidencia exacta primero: es la que no se puede equivocar.
      const exacto = normalizados.indexOf(alias)
      if (exacto !== -1) {
        mapa[campo] = exacto
        break
      }
    }
    if (mapa[campo] !== null) continue

    // Si no hubo exacta, se acepta que el encabezado CONTENGA el alias. Cubre
    // cosas como «Precio (incl. impuestos)». Se exige que el alias tenga al
    // menos 5 caracteres para que «room» no matchee cualquier cosa.
    for (const alias of ALIAS[campo]) {
      if (alias.length < 5) continue
      const parcial = normalizados.findIndex((h) => h.includes(alias))
      if (parcial !== -1) {
        mapa[campo] = parcial
        break
      }
    }
  }

  return mapa
}

/**
 * Sin estos cuatro no hay reserva posible.
 *
 * `externalId` porque sin él no hay idempotencia; las fechas porque definen la
 * ocupación; el apellido porque es lo único que permite reconocer al huésped en
 * el mostrador.
 */
export const CAMPOS_OBLIGATORIOS: readonly CampoBooking[] = [
  'externalId',
  'huesped',
  'checkIn',
  'checkOut',
]

/** Encabezados obligatorios que faltan, para poder decirlo en pantalla. */
export function obligatoriosFaltantes(mapa: Record<CampoBooking, number | null>): CampoBooking[] {
  return CAMPOS_OBLIGATORIOS.filter((c) => mapa[c] === null)
}

/* ─────────────────────────────────────────────────────────────── fechas ──── */

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})/
const RE_BARRAS = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/

/**
 * Interpreta una fecha del informe y la devuelve en ISO.
 *
 * ── El problema del día y el mes ────────────────────────────────────────────
 *
 * `10/09/2026` es el 10 de septiembre si el archivo salió en español y el 9 de
 * octubre si salió en inglés. **No se puede resolver mirando el valor**, y elegir
 * mal produce una reserva perfectamente plausible en la fecha equivocada: nadie
 * lo detecta hasta que el huésped aparece.
 *
 * Se asume **día/mes/año**, que es el formato del extranet en español y el que va
 * a usar el hotel. Cuando el primer número es mayor que 12 se puede descartar la
 * otra lectura y se toma con certeza. La ambigüedad restante se informa, para que
 * la pantalla pueda advertirla.
 *
 * Devuelve `null` si no reconoce el formato: es preferible rechazar la fila a
 * inventarle una fecha.
 */
export function interpretarFecha(valor: string): { iso: string; ambigua: boolean } | null {
  const v = valor.trim()
  if (!v) return null

  const iso = RE_ISO.exec(v)
  if (iso) {
    const [, a, m, d] = iso
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return { iso: `${a}-${m}-${d}`, ambigua: false }
  }

  const barras = RE_BARRAS.exec(v)
  if (barras) {
    const [, primero, segundo, anio] = barras
    const p = Number(primero)
    const s = Number(segundo)

    // Si el primero pasa de 12, es el día sin lugar a dudas.
    if (p > 12 && s >= 1 && s <= 12) {
      return { iso: `${anio}-${pad(s)}-${pad(p)}`, ambigua: false }
    }
    // Si el segundo pasa de 12, entonces el formato es mes/día.
    if (s > 12 && p >= 1 && p <= 12) {
      return { iso: `${anio}-${pad(p)}-${pad(s)}`, ambigua: false }
    }
    if (p >= 1 && p <= 12 && s >= 1 && s <= 12) {
      // Los dos podrían ser el mes. Se asume día/mes y se avisa.
      return { iso: `${anio}-${pad(s)}-${pad(p)}`, ambigua: true }
    }
    return null
  }

  return null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Lleva una fecha `YYYY-MM-DD` a timestamp ISO completo.
 *
 * Existe para que `emitidaEn` sea siempre comparable como string: la fecha del
 * informe no trae hora, y mezclar `'2026-09-10'` con
 * `'2026-09-10T14:00:00.000Z'` en la misma comparación da un orden equivocado.
 */
function aTimestamp(fecha: string | undefined, ahora: Date): string {
  if (!fecha) return ahora.toISOString()
  return `${fecha}T00:00:00.000Z`
}

/* ──────────────────────────────────────────────────────────── importes ──── */

/**
 * Interpreta un importe que puede venir en formato europeo o anglosajón.
 *
 * `1.234,56` y `1,234.56` son el mismo número escrito de dos formas, y la
 * diferencia entre leerlos bien o mal es un factor de mil. La regla: el **último**
 * separador que aparezca es el decimal; todo lo anterior son miles.
 */
export function interpretarImporte(valor: string): number | null {
  const v = valor.replace(/[^\d.,-]/g, '').trim()
  if (!v) return null

  const ultimaComa = v.lastIndexOf(',')
  const ultimoPunto = v.lastIndexOf('.')

  let normalizado: string
  if (ultimaComa === -1 && ultimoPunto === -1) {
    normalizado = v
  } else if (ultimaComa > ultimoPunto) {
    // La coma es el decimal: se quitan los puntos de miles.
    normalizado = v.replace(/\./g, '').replace(',', '.')
  } else {
    normalizado = v.replace(/,/g, '')
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/* ──────────────────────────────────────────────────────────── estado ──── */

/**
 * Traduce el estado que informa Booking a la operación de nuestro dominio.
 *
 * Todo lo que no se reconozca cae en `nueva`, que es el caso conservador: la
 * reserva aterriza en la zona de recepción y alguien la mira. Interpretar un
 * estado desconocido como `cancelada` liberaría una unidad vendida.
 */
export function interpretarOperacion(valor: string): ReservaDeCanal['operacion'] {
  const v = normalizarEncabezado(valor)
  if (!v) return 'nueva'
  if (v.includes('cancel') || v.includes('anulad')) return 'cancelada'
  if (v.includes('modific') || v.includes('modified') || v.includes('amend')) return 'modificada'
  return 'nueva'
}

/** Parte «Apellido, Nombre» o «Nombre Apellido» en sus dos partes. */
export function partirNombre(completo: string): { apellido: string; nombre: string } {
  const v = completo.trim().replace(/\s+/g, ' ')
  if (!v) return { apellido: '', nombre: '' }

  // Con coma, el extranet pone «Apellido, Nombre» y no hay ambigüedad.
  if (v.includes(',')) {
    const [ap, ...resto] = v.split(',')
    return { apellido: ap.trim(), nombre: resto.join(',').trim() }
  }

  const partes = v.split(' ')
  if (partes.length === 1) return { apellido: partes[0], nombre: '' }

  // Sin coma se asume «Nombre Apellido», que es como lo manda Booking en inglés.
  // El apellido es la última palabra: con nombres compuestos se puede equivocar,
  // pero el nombre completo queda igual en las notas por si hace falta.
  return { apellido: partes[partes.length - 1], nombre: partes.slice(0, -1).join(' ') }
}

/* ────────────────────────────────────────────────────────── resultado ──── */

export interface FilaRechazada {
  /** Número de fila en el archivo, contando el encabezado como 1. */
  fila: number
  motivos: string[]
}

export interface ResultadoCsv {
  reservas: ReservaDeCanal[]
  rechazadas: FilaRechazada[]
  /** Encabezados obligatorios que no se encontraron. Si hay, no se leyó nada. */
  faltantes: CampoBooking[]
  /** Filas con una fecha ambigua (día/mes indistinguible), para advertir. */
  fechasAmbiguas: number
  /** Total de filas de datos encontradas. */
  leidas: number
  /**
   * Encabezados tal como venían en el archivo, y hasta tres valores de ejemplo de
   * cada columna.
   *
   * Se devuelven **siempre**, y sobre todo cuando el lector NO pudo interpretar el
   * archivo: son el material con el que la pantalla de mapeo manual le pregunta al
   * usuario qué columna es cuál. Sin ellos, «no se reconocieron las columnas» es un
   * callejón sin salida.
   *
   * Las columnas prohibidas vienen con el encabezado en blanco y sin muestra: no se
   * ofrecen para mapear ni se muestran, porque el sistema no guarda datos de tarjeta.
   */
  encabezados: string[]
  muestra: string[][]
}

/**
 * Lee el informe completo.
 *
 * No corta en el primer error: una fila mala no invalida el archivo. Se devuelven
 * las buenas y el detalle de las rechazadas, porque quien importa necesita saber
 * exactamente qué quedó afuera y por qué — si el archivo trae 40 reservas y
 * entraron 38, hay que poder ver las dos que faltan.
 */
export function interpretarCsvBooking(
  texto: string,
  canal: CanalVenta = 'booking',
  /**
   * Mapeo guardado por una persona: *campo → encabezado normalizado*.
   *
   * Gana sobre el diccionario de alias para los campos que menciona, y el diccionario
   * sigue cubriendo el resto. Así un mapeo parcial —solo las columnas que la
   * heurística erró— alcanza, que es el caso normal.
   */
  mapeoGuardado: Record<string, string> | null = null,
  /**
   * El momento que se usa como `emitidaEn` para las filas cuyo informe **no trae**
   * fecha de reserva.
   *
   * Entra por parámetro para que esta función sea de verdad pura, que es como está
   * documentada y como la tratan sus 54 tests. Antes leía el reloj adentro, y eso
   * hacía que el mismo CSV produjera una salida distinta en cada corrida: el
   * test-contrato que verifica que **ningún dato de tarjeta** quede en el resultado
   * serializa todo y busca subcadenas, así que fallaba una de cada mil veces cuando
   * los milisegundos formaban «737», el CVC del caso de prueba. Un test de seguridad
   * que falla al azar termina desactivado por molesto.
   */
  ahora: Date = new Date(),
): ResultadoCsv {
  const vacio: ResultadoCsv = {
    reservas: [],
    rechazadas: [],
    faltantes: [],
    fechasAmbiguas: 0,
    leidas: 0,
    encabezados: [],
    muestra: [],
  }

  const filas = partirCsv(texto)
  if (filas.length < 2) {
    // Sin encabezado + al menos una fila no hay nada que leer. Se informa como
    // «faltan todos los obligatorios», que es lo que la pantalla sabe explicar.
    return { ...vacio, faltantes: [...CAMPOS_OBLIGATORIOS] }
  }

  /*
    Los encabezados y la muestra se calculan ANTES de decidir si el archivo se puede
    leer, y se devuelven en los dos casos. Es lo que convierte «no se reconocieron las
    columnas» en algo accionable: la pantalla de mapeo necesita saber qué columnas hay
    y qué traen para poder preguntar.

    Las prohibidas se blanquean acá también, no solo en el mapeo: no se muestran ni se
    ofrecen. Una muestra de una columna de tarjetas sería exponer un PAN en pantalla.
  */
  const encabezados = filas[0].map((h) => (esColumnaProhibida(h) ? '' : h))
  const muestraCruda = muestraDeColumnas(filas, filas[0].length)
  const muestra = muestraCruda.map((m, i) => (encabezados[i] === '' ? [] : m))
  const conContexto = { ...vacio, encabezados, muestra }

  const propuesta = mapearColumnas(filas[0])
  const { indices: mapa } = resolverIndices(propuesta, mapeoGuardado, filas[0], normalizarEncabezado)

  const faltantes = obligatoriosFaltantes(mapa)
  if (faltantes.length > 0) return { ...conContexto, faltantes }

  const reservas: ReservaDeCanal[] = []
  const rechazadas: FilaRechazada[] = []
  let fechasAmbiguas = 0

  const celda = (f: readonly string[], campo: CampoBooking): string => {
    const i = mapa[campo]
    return i === null ? '' : (f[i] ?? '').trim()
  }

  for (let n = 1; n < filas.length; n++) {
    const f = filas[n]
    const motivos: string[] = []

    const externalId = celda(f, 'externalId')
    if (!externalId) motivos.push('Falta el número de reserva.')

    const { apellido, nombre } = partirNombre(celda(f, 'huesped'))
    if (!apellido) motivos.push('Falta el nombre del huésped.')

    const entrada = interpretarFecha(celda(f, 'checkIn'))
    const salida = interpretarFecha(celda(f, 'checkOut'))
    if (!entrada) motivos.push('La fecha de entrada no se pudo interpretar.')
    if (!salida) motivos.push('La fecha de salida no se pudo interpretar.')
    if (entrada && salida && salida.iso <= entrada.iso) {
      motivos.push('La salida no puede ser anterior o igual a la entrada.')
    }
    if (entrada?.ambigua || salida?.ambigua) fechasAmbiguas++

    if (motivos.length > 0) {
      // +1 porque para quien abre el archivo en Excel la primera fila es la 1.
      rechazadas.push({ fila: n + 1, motivos })
      continue
    }

    const personas = Number(celda(f, 'personas').replace(/[^\d]/g, ''))
    const importe = interpretarImporte(celda(f, 'importe'))
    const comision = interpretarImporte(celda(f, 'comision'))
    const moneda = celda(f, 'moneda').toUpperCase().slice(0, 3)

    reservas.push({
      externalId,
      canal,
      tipoUnidadCodigo: celda(f, 'tipoUnidad') || 'SIN-TIPO',
      checkIn: entrada!.iso,
      checkOut: salida!.iso,
      huespedes: Number.isFinite(personas) && personas > 0 ? personas : 1,
      huesped: {
        apellido,
        nombre,
        email: celda(f, 'email') || null,
        telefono: celda(f, 'telefono') || null,
        pais: celda(f, 'pais') || null,
      },
      importeCanal: importe ?? 0,
      monedaCanal: moneda || 'USD',
      comision: comision,
      // Quién cobra. `interpretarModalidadCobro` es conservador: lo que no reconoce
      // cae en `desconocida`, nunca en una suposición, porque adivinar mal termina
      // en cobrarle dos veces a alguien o en dejarlo salir sin cobrarle.
      modalidadCobro: interpretarModalidadCobro(celda(f, 'modalidadCobro')),
      notas: celda(f, 'notas') || null,
      operacion: interpretarOperacion(celda(f, 'estado')),
      // Si el informe trae la fecha de reserva se usa como momento del evento; si
      // no, la de importación. `emitidaEn` decide qué evento gana cuando llegan
      // fuera de orden, así que no puede quedar vacío.
      //
      // ⚠️ Se completa a timestamp ISO y no se deja como `YYYY-MM-DD`: la
      // comparación de `esEventoMasReciente` es de strings, y `'2026-09-10'` es
      // menor que `'2026-09-10T00:00:00.000Z'`. Mezclar los dos formatos haría
      // que una fila del CSV nunca le gane a una guardada del mismo día.
      emitidaEn: aTimestamp(interpretarFecha(celda(f, 'reservadaEn'))?.iso, ahora),
    })
  }

  return {
    reservas,
    rechazadas,
    faltantes: [],
    fechasAmbiguas,
    leidas: filas.length - 1,
    encabezados,
    muestra,
  }
}
