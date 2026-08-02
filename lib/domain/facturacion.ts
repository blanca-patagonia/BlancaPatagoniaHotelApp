/**
 * Facturación electrónica argentina (lógica pura).
 *
 * Modela lo que define AFIP/ARCA para el Régimen de Emisión de Comprobantes
 * Electrónicos: qué letra de comprobante corresponde según la condición frente
 * al IVA de emisor y receptor, cómo se discrimina el impuesto y cómo se valida
 * un CUIT y un CAE.
 *
 * Acá NO hay ninguna llamada a AFIP: la conexión con el organismo vive detrás
 * de `FacturacionElectronicaProvider` (ver `lib/facturacion/index.ts`) y hoy es
 * un stub. Ver ADR 0012.
 */

/* ─────────────────────────────────────────────── condición frente al IVA ── */

export const CONDICIONES_IVA = [
  'responsable_inscripto',
  'monotributo',
  'exento',
  'consumidor_final',
] as const

export type CondicionIva = (typeof CONDICIONES_IVA)[number]

export const ETIQUETAS_CONDICION_IVA: Record<CondicionIva, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor Final',
}

/* ────────────────────────────────────────────────── tipo de comprobante ── */

export const TIPOS_COMPROBANTE = ['A', 'B', 'C'] as const
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number]

export const ETIQUETAS_COMPROBANTE: Record<TipoComprobante, string> = {
  A: 'Factura A',
  B: 'Factura B',
  C: 'Factura C',
}

/**
 * Determina la letra del comprobante.
 *
 * Regla de AFIP:
 * · Emisor monotributista o exento → siempre **C** (no discrimina IVA).
 * · Emisor responsable inscripto:
 *     · receptor responsable inscripto → **A** (IVA discriminado)
 *     · cualquier otro receptor        → **B** (IVA incluido en el precio)
 */
export function tipoComprobante(
  emisor: CondicionIva,
  receptor: CondicionIva,
): TipoComprobante {
  if (emisor !== 'responsable_inscripto') return 'C'
  return receptor === 'responsable_inscripto' ? 'A' : 'B'
}

/** Solo la factura A muestra el IVA como renglón aparte. */
export function discriminaIva(tipo: TipoComprobante): boolean {
  return tipo === 'A'
}

/** El comprobante A exige identificar al receptor con su CUIT. */
export function exigeCuitReceptor(tipo: TipoComprobante): boolean {
  return tipo === 'A'
}

/* ─────────────────────────────────────────────────────────────── IVA ───── */

/** Alícuotas vigentes en Argentina. La hotelería tributa al 21 %. */
export const ALICUOTAS_IVA = [0, 10.5, 21, 27] as const
export type AlicuotaIva = (typeof ALICUOTAS_IVA)[number]

export interface DesgloseIva {
  neto: number
  iva: number
  total: number
  alicuota: number
}

/** Redondeo a dos decimales, evitando el error binario de coma flotante. */
function aCentavos(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

/**
 * Separa un importe **final** (con IVA incluido) en neto e impuesto.
 *
 * Es el sentido que se necesita acá: las tarifas del hotel se publican con IVA
 * incluido, y la factura tiene que mostrar el neto por separado.
 */
export function desglosarIva(totalConIva: number, alicuota: number): DesgloseIva {
  if (alicuota <= 0) {
    const total = aCentavos(totalConIva)
    return { neto: total, iva: 0, total, alicuota: 0 }
  }
  const neto = aCentavos(totalConIva / (1 + alicuota / 100))
  const total = aCentavos(totalConIva)
  // El IVA se obtiene por diferencia para que neto + iva === total siempre,
  // aunque el redondeo de cada parte por separado no cerrara.
  return { neto, iva: aCentavos(total - neto), total, alicuota }
}

/** Agrega un importe neto su IVA, en el sentido inverso. */
export function agregarIva(neto: number, alicuota: number): DesgloseIva {
  const iva = aCentavos(neto * (alicuota / 100))
  return { neto: aCentavos(neto), iva, total: aCentavos(neto + iva), alicuota }
}

/* ────────────────────────────────────────────────────────────── CUIT ───── */

/** Multiplicadores del dígito verificador de CUIT/CUIL. */
const MULTIPLICADORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

/** Deja solo los dígitos (acepta `30-71234567-8` o `30712345678`). */
export function normalizarCuit(cuit: string): string {
  return cuit.replace(/\D/g, '')
}

/**
 * Valida un CUIT con su dígito verificador (módulo 11).
 *
 * Evita cargar un CUIT tipeado mal en una factura A, que AFIP rechazaría.
 */
export function cuitValido(cuit: string): boolean {
  const digitos = normalizarCuit(cuit)
  if (digitos.length !== 11) return false

  const suma = MULTIPLICADORES.reduce(
    (acc, mult, i) => acc + mult * Number(digitos[i]),
    0,
  )
  const resto = suma % 11
  let verificador = 11 - resto
  if (verificador === 11) verificador = 0
  // El 10 no se asigna nunca: ese CUIT no existe.
  if (verificador === 10) return false

  return verificador === Number(digitos[10])
}

/** Presenta el CUIT como `30-71234567-8`. */
export function formatearCuit(cuit: string): string {
  const d = normalizarCuit(cuit)
  if (d.length !== 11) return cuit
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
}

/* ─────────────────────────────────────────────────────────────── CAE ───── */

/**
 * Número de comprobante con el formato oficial `PPPP-NNNNNNNN`
 * (punto de venta de 4 dígitos, número de 8).
 */
export function numeroComprobante(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, '0')}-${String(numero).padStart(8, '0')}`
}

/**
 * El CAE tiene una fecha de vencimiento: pasada esa fecha el comprobante ya no
 * puede entregarse al cliente.
 */
export function caeVigente(caeVto: string | null | undefined, hoy: string): boolean {
  if (!caeVto) return false
  return caeVto >= hoy
}

/** Una factura está fiscalmente completa cuando tiene CAE y su vencimiento. */
export function tieneCae(factura: { cae?: string | null; cae_vto?: string | null }): boolean {
  return Boolean(factura.cae && factura.cae_vto)
}
