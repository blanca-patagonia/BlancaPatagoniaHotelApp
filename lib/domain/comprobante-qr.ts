/**
 * Lectura del código QR de una factura electrónica argentina (lógica pura).
 *
 * ── Por qué esto y no OCR ───────────────────────────────────────────────────
 *
 * El pedido dice «que se le saque una foto a una factura y que se carguen los
 * datos». La forma obvia sería reconocimiento de texto sobre la imagen. Es peor
 * idea de lo que parece:
 *
 *  · El OCR **adivina**. Un `8` leído como `3` en el importe da una factura
 *    plausible y equivocada, y nadie la revisa porque el sistema «ya la cargó».
 *  · Necesita un servicio pago de terceros, con la imagen de una factura —datos
 *    fiscales del hotel y del proveedor— saliendo del sistema.
 *
 * **Desde 2021 toda factura electrónica argentina lleva un QR obligatorio** (RG
 * 4892/2020) que codifica los datos del comprobante en JSON. Leer ese QR no
 * adivina nada: devuelve exactamente lo que el emisor le informó a ARCA, con su
 * CAE. Es el mismo gesto para quien usa el sistema —apuntar la cámara a la
 * factura— y el resultado es **autoritativo en vez de probable**.
 *
 * El OCR queda como puerto aparte (`OcrComprobanteProvider`) para los casos que
 * el QR no cubre: un ticket, un remito, una factura anterior a 2021.
 *
 * ── El formato (especificación oficial, versión 1) ──────────────────────────
 *
 * El QR contiene una URL:
 *
 *     https://www.arca.gob.ar/fe/qr/?p=<JSON en base64>
 *
 * (el dominio histórico es `afip.gob.ar`; se aceptan los dos, y también el JSON
 * pelado, porque algunos lectores devuelven sólo el parámetro).
 *
 * Y el JSON:
 *
 * | Campo        | Qué es                                                |
 * |--------------|-------------------------------------------------------|
 * | `ver`        | versión del formato (1)                                |
 * | `fecha`      | fecha de emisión, `YYYY-MM-DD`                         |
 * | `cuit`       | CUIT del **emisor**                                    |
 * | `ptoVta`     | punto de venta                                         |
 * | `tipoCmp`    | código de tipo de comprobante de WSFEv1 (1, 6, 11…)    |
 * | `nroCmp`     | número del comprobante                                 |
 * | `importe`    | total                                                  |
 * | `moneda`     | **código de ARCA**, no ISO: `PES`, `DOL`               |
 * | `ctz`        | cotización aplicada                                    |
 * | `tipoDocRec` | tipo de documento del receptor                         |
 * | `nroDocRec`  | número de documento del receptor                       |
 * | `tipoCodAut` | `E` = CAE, `A` = CAEA                                  |
 * | `codAut`     | el CAE (14 dígitos)                                    |
 *
 * ⚠️ **`moneda` NO es ISO 4217.** `PES` no existe en ISO y `DOL` tampoco: los
 * códigos son de ARCA. Guardarlos tal cual en una columna que el resto del
 * sistema lee como ISO haría que un comprobante en pesos no se pueda sumar con
 * nada. Se traducen acá, en un solo lugar.
 */

/* ────────────────────────────────────────────────── tipos de comprobante ──── */

/**
 * Códigos de WSFEv1 que este sistema entiende, con su letra.
 *
 * Se listan sólo los que puede recibir un hotel: facturas, notas de crédito y
 * notas de débito A, B y C. Un código fuera de la lista **no se adivina** —se
 * guarda el número y se muestra tal cual—, porque inventar la letra de un
 * comprobante fiscal es exactamente el error que después hay que corregir con
 * otro comprobante.
 */
export const TIPOS_COMPROBANTE_ARCA: Record<number, { letra: string; nombre: string }> = {
  1: { letra: 'A', nombre: 'Factura A' },
  2: { letra: 'A', nombre: 'Nota de débito A' },
  3: { letra: 'A', nombre: 'Nota de crédito A' },
  6: { letra: 'B', nombre: 'Factura B' },
  7: { letra: 'B', nombre: 'Nota de débito B' },
  8: { letra: 'B', nombre: 'Nota de crédito B' },
  11: { letra: 'C', nombre: 'Factura C' },
  12: { letra: 'C', nombre: 'Nota de débito C' },
  13: { letra: 'C', nombre: 'Nota de crédito C' },
  51: { letra: 'M', nombre: 'Factura M' },
  52: { letra: 'M', nombre: 'Nota de débito M' },
  53: { letra: 'M', nombre: 'Nota de crédito M' },
}

/** Nombre del comprobante, o el código crudo si no está en la tabla. */
export function nombreDeComprobante(codigo: number): string {
  return TIPOS_COMPROBANTE_ARCA[codigo]?.nombre ?? `Comprobante tipo ${codigo}`
}

/**
 * ¿Este comprobante **resta** en lugar de sumar?
 *
 * Las notas de crédito (3, 8, 13, 53) devuelven plata: cargarlas como un gasto
 * más infla lo que el hotel debe. El signo se decide acá y no en la pantalla.
 */
export function esNotaDeCredito(codigo: number): boolean {
  return codigo === 3 || codigo === 8 || codigo === 13 || codigo === 53
}

/* ──────────────────────────────────────────────────────────── moneda ──── */

/**
 * Códigos de moneda de ARCA → ISO 4217, que es lo que usa el resto del sistema.
 *
 * Sólo las cuatro que el sistema sabe cotizar (`lib/domain/divisas.ts`) y que los
 * `check` de la base admiten. Una moneda fuera de la lista devuelve `null` **a
 * propósito**: dejarla pasar tal cual haría fallar el `insert` con un error de
 * restricción ilegible, en vez de decir en español que hay que cargarla a mano.
 */
const MONEDA_ARCA: Record<string, string> = {
  PES: 'ARS',
  ARS: 'ARS',
  DOL: 'USD',
  USD: 'USD',
  // Códigos numéricos de la tabla de monedas de ARCA.
  '060': 'EUR',
  EUR: 'EUR',
  '012': 'BRL',
  BRL: 'BRL',
}

export function monedaDesdeArca(codigo: string): string | null {
  return MONEDA_ARCA[codigo.trim().toUpperCase()] ?? null
}

/* ────────────────────────────────────────────────────────── el modelo ──── */

/** Un comprobante leído del QR. Todos los campos vienen del emisor, no de un OCR. */
export interface ComprobanteLeido {
  cuitEmisor: string
  puntoVenta: number
  numero: number
  tipoCodigo: number
  /** `A`, `B`, `C`, `M`… o `null` si el código no está en la tabla. */
  letra: string | null
  fecha: string
  total: number
  /** ISO 4217, ya traducida desde el código de ARCA. */
  moneda: string
  cotizacion: number
  /** El CAE. `tipoCodAut` distingue CAE (`E`) de CAEA (`A`). */
  cae: string
  tipoAutorizacion: string
  /** Documento del receptor: sirve para verificar que la factura es del hotel. */
  nroDocReceptor: string | null
}

export type MotivoQrInvalido =
  | 'vacio'
  | 'no_es_qr_de_factura'
  | 'base64'
  | 'json'
  | 'version'
  | 'campos'
  | 'moneda'

export const MENSAJES_QR_INVALIDO: Record<MotivoQrInvalido, string> = {
  vacio: 'No se leyó nada. Acercá la cámara al código QR de la factura.',
  no_es_qr_de_factura:
    'Ese QR no es el de una factura electrónica argentina. El de la factura empieza con «arca.gob.ar/fe/qr» o «afip.gob.ar/fe/qr».',
  base64: 'El contenido del QR está dañado y no se pudo decodificar.',
  json: 'El contenido del QR no tiene el formato esperado.',
  version:
    'El QR usa una versión del formato que este sistema todavía no entiende. Cargá los datos a mano.',
  campos:
    'Al QR le faltan datos obligatorios (CUIT, número, fecha o importe). Cargá los datos a mano.',
  moneda:
    'La moneda del comprobante no es una que el sistema sepa convertir. Cargá los datos a mano.',
}

export interface ResultadoQr {
  comprobante: ComprobanteLeido | null
  motivo: MotivoQrInvalido | null
}

/* ────────────────────────────────────────────────────────── el lector ──── */

/**
 * Acepta tanto la URL completa como el JSON en base64 pelado.
 *
 * Los lectores de QR devuelven cosas distintas: la cámara del teléfono suele dar
 * la URL entera, y algunas bibliotecas devuelven sólo el valor del parámetro. Que
 * el sistema acepte las dos formas evita que quien escanea tenga que saber cuál
 * le tocó.
 */
function extraerPayload(texto: string): { payload: string } | { motivo: MotivoQrInvalido } {
  const t = texto.trim()
  if (!t) return { motivo: 'vacio' }

  if (/^https?:\/\//i.test(t)) {
    let url: URL
    try {
      url = new URL(t)
    } catch {
      return { motivo: 'no_es_qr_de_factura' }
    }

    // Se acepta el dominio nuevo (arca) y el histórico (afip). Cualquier otro
    // host es otro QR: un link de pago, una web, un wifi.
    const host = url.hostname.toLowerCase()
    const esDeArca = host.endsWith('arca.gob.ar') || host.endsWith('afip.gob.ar')
    if (!esDeArca || !url.pathname.includes('/fe/qr')) return { motivo: 'no_es_qr_de_factura' }

    const p = url.searchParams.get('p')
    return p ? { payload: p } : { motivo: 'no_es_qr_de_factura' }
  }

  // JSON en base64 pelado. Un texto cualquiera cae acá y falla en `atob` o en
  // `JSON.parse`, que es lo correcto: no se intenta interpretarlo de otra forma.
  return { payload: t }
}

/**
 * Decodifica el payload, con el mismo resultado en el navegador y en el servidor.
 *
 * ⚠️ La forma se valida **antes** de decodificar, y no es por prolijidad: `atob`
 * lanza ante un carácter inválido y `Buffer.from(x, 'base64')` lo ignora en
 * silencio y devuelve basura. Sin la validación previa, el mismo QR ilegible daría
 * el motivo `base64` en el navegador y `json` en el servidor — y depurar eso a
 * partir de un reporte de alguien que sólo vio el mensaje es innecesariamente
 * difícil.
 */
function decodificarBase64(valor: string): string | null {
  // Base64 url-safe: algunos emisores lo generan así.
  const normalizado = valor.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizado)) return null

  try {
    return typeof atob === 'function'
      ? atob(normalizado)
      : Buffer.from(normalizado, 'base64').toString('binary')
  } catch {
    return null
  }
}

function comoTexto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : typeof valor === 'number' ? String(valor) : ''
}

function comoNumero(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : Number(comoTexto(valor))
  return Number.isFinite(n) ? n : null
}

/**
 * Lee el QR de una factura electrónica.
 *
 * **Nunca lanza.** Un QR ilegible es lo normal —una foto movida, un papel
 * arrugado, el QR de otra cosa— y una excepción dejaría a quien escanea sin saber
 * qué pasó. Devuelve el motivo, que la pantalla traduce con
 * `MENSAJES_QR_INVALIDO`.
 *
 * ⚠️ **No valida que el CAE exista.** Eso lo sabe ARCA, no este sistema: leer el
 * QR dice qué informó el emisor, no que ARCA lo haya autorizado. Verificarlo
 * contra el organismo es otro trabajo y necesita certificado (Bloque D).
 */
export function leerQrDeFactura(texto: string): ResultadoQr {
  const extraido = extraerPayload(texto)
  if ('motivo' in extraido) return { comprobante: null, motivo: extraido.motivo }

  const json = decodificarBase64(extraido.payload)
  if (json === null) return { comprobante: null, motivo: 'base64' }

  let datos: Record<string, unknown>
  try {
    const parseado: unknown = JSON.parse(json)
    if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
      return { comprobante: null, motivo: 'json' }
    }
    datos = parseado as Record<string, unknown>
  } catch {
    return { comprobante: null, motivo: 'json' }
  }

  // La versión se mira antes que nada: si ARCA publica un formato 2 con otros
  // campos, interpretarlo con las reglas del 1 daría un comprobante equivocado.
  const version = comoNumero(datos.ver)
  if (version !== 1) return { comprobante: null, motivo: 'version' }

  const cuit = comoTexto(datos.cuit)
  const fecha = comoTexto(datos.fecha)
  const puntoVenta = comoNumero(datos.ptoVta)
  const numero = comoNumero(datos.nroCmp)
  const tipoCodigo = comoNumero(datos.tipoCmp)
  const total = comoNumero(datos.importe)
  const cae = comoTexto(datos.codAut)

  const faltaAlgo =
    !/^\d{11}$/.test(cuit) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
    puntoVenta === null ||
    numero === null ||
    tipoCodigo === null ||
    total === null ||
    !cae
  if (faltaAlgo) return { comprobante: null, motivo: 'campos' }

  const moneda = monedaDesdeArca(comoTexto(datos.moneda) || 'PES')
  if (!moneda) return { comprobante: null, motivo: 'moneda' }

  const cotizacion = comoNumero(datos.ctz)
  const nroDocRec = comoTexto(datos.nroDocRec)

  return {
    motivo: null,
    comprobante: {
      cuitEmisor: cuit,
      puntoVenta,
      numero,
      tipoCodigo,
      letra: TIPOS_COMPROBANTE_ARCA[tipoCodigo]?.letra ?? null,
      fecha,
      total,
      moneda,
      // Sin cotización declarada, 1 es lo correcto y no una suposición: un
      // comprobante en pesos emitido en pesos no lleva conversión.
      cotizacion: cotizacion && cotizacion > 0 ? cotizacion : 1,
      cae,
      tipoAutorizacion: comoTexto(datos.tipoCodAut) || 'E',
      nroDocReceptor: nroDocRec || null,
    },
  }
}

/* ─────────────────────────────────────────── identidad del comprobante ──── */

/**
 * Clave natural de un comprobante fiscal argentino.
 *
 * `CUIT del emisor · tipo · punto de venta · número` identifica un comprobante de
 * forma única en todo el país. Es la clave de idempotencia: escanear dos veces la
 * misma factura —cosa que pasa cuando la foto sale movida y se repite— no puede
 * cargar el gasto dos veces.
 */
export function claveDeComprobante(c: {
  cuitEmisor: string
  tipoCodigo: number
  puntoVenta: number
  numero: number
}): string {
  const pv = String(c.puntoVenta).padStart(5, '0')
  const nro = String(c.numero).padStart(8, '0')
  return `${c.cuitEmisor}-${c.tipoCodigo}-${pv}-${nro}`
}

/** Número visible del comprobante: `0003-00001234`. */
export function numeroVisible(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, '0')}-${String(numero).padStart(8, '0')}`
}

/* ────────────────────────────────────── ¿es una factura para el hotel? ──── */

/**
 * Avisos sobre un comprobante recién leído. Vacío = nada que observar.
 *
 * No bloquean la carga: son advertencias. El caso real que justifica esto es la
 * factura que alguien fotografía por error —la de otro cliente, la de su
 * consumo personal— y que sin aviso entraría como un gasto del hotel.
 */
export function avisosDelComprobante(
  c: ComprobanteLeido,
  cuitDelHotel: string | null,
): string[] {
  const avisos: string[] = []

  if (cuitDelHotel && c.nroDocReceptor && c.nroDocReceptor !== cuitDelHotel.replace(/\D/g, '')) {
    avisos.push(
      'El receptor de esta factura no es el CUIT del hotel. Revisá que sea un comprobante que corresponda cargar.',
    )
  }
  if (esNotaDeCredito(c.tipoCodigo)) {
    avisos.push('Es una nota de crédito: resta del saldo con el proveedor, no lo aumenta.')
  }
  if (c.letra === null) {
    avisos.push(
      `El tipo de comprobante (${c.tipoCodigo}) no está en la tabla del sistema, así que la letra queda sin determinar.`,
    )
  }

  return avisos
}
