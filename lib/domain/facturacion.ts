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

/* ──────────────────────────────────────────── cuándo se puede facturar ── */

/**
 * Estados de reserva que admiten emitir el comprobante.
 *
 * Se factura lo que el huésped **consumió o se comprometió a pagar**:
 * · `in_house` — está alojado, se le puede cerrar la cuenta;
 * · `pagada`   — abonó por adelantado;
 * · `checkout` — cerró su estadía.
 *
 * Debe mantenerse en sincronía con `EstadoReserva` (`lib/domain/reservas.ts`).
 */
export const ESTADOS_FACTURABLES = ['pagada', 'in_house', 'checkout'] as const

/** Motivo por el que una reserva no se puede facturar; `null` si sí se puede. */
export type MotivoNoFacturable = 'sin_consumir' | 'anulada' | 'ya_facturada'

export const MENSAJES_NO_FACTURABLE: Record<MotivoNoFacturable, string> = {
  sin_consumir:
    'La reserva todavía no se consumió: se factura recién cuando el huésped ingresa, paga o hace el check-out.',
  anulada: 'La reserva está cancelada o marcada como no-show: no corresponde emitir comprobante.',
  ya_facturada: 'Esta reserva ya tiene su comprobante emitido.',
}

/**
 * Determina si corresponde emitir el comprobante de una reserva.
 *
 * Sin esta regla se podía facturar una reserva **pendiente o cancelada**: con un
 * CAE real eso deja un comprobante fiscal emitido que después hay que anular con
 * una nota de crédito. La validación vive acá, y no en la pantalla, para que sea
 * la misma sin importar desde dónde se dispare.
 */
export function motivoNoFacturable(
  estado: string,
  yaTieneFactura: boolean,
): MotivoNoFacturable | null {
  if (yaTieneFactura) return 'ya_facturada'
  if (estado === 'cancelada' || estado === 'no_show') return 'anulada'
  if (!(ESTADOS_FACTURABLES as readonly string[]).includes(estado)) return 'sin_consumir'
  return null
}

export function puedeFacturarse(estado: string, yaTieneFactura = false): boolean {
  return motivoNoFacturable(estado, yaTieneFactura) === null
}

/* ────────────────────────────────────────────────── notas de crédito ──── */

/**
 * Reglas de la nota de crédito (migración 0076).
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * `facturas` es inmutable (0034) y hay una sola por reserva (0045): la nota de
 * crédito es el **único** camino para corregir un comprobante mal emitido. Con el
 * simulador eso es un inconveniente; con CAE real, un problema fiscal.
 *
 * Las reglas duras —la letra la hereda de la factura y no se puede acreditar más
 * de lo facturado— viven en la base, en los triggers de la 0076, porque dos
 * emisiones simultáneas leerían el mismo acumulado y las dos pasarían una
 * comprobación hecha en la aplicación. Acá está lo que hace falta para **decirlo
 * en pantalla antes** de intentarlo.
 */

export const MOTIVO_NC_MINIMO = 5

export type MotivoNoAcreditar =
  | 'sin_factura'
  | 'sin_cae'
  | 'importe'
  | 'excede'
  | 'motivo_corto'

export const MENSAJES_NO_ACREDITAR: Record<MotivoNoAcreditar, string> = {
  sin_factura: 'Esta reserva no tiene factura emitida: no hay nada que acreditar.',
  sin_cae:
    'La factura todavía no tiene CAE. Sin comprobante autorizado no corresponde una nota de crédito.',
  importe: 'El importe de la nota de crédito tiene que ser mayor que cero.',
  excede:
    'No se puede acreditar más de lo facturado: revisá el importe contra lo que queda sin acreditar.',
  motivo_corto: 'Escribí el motivo de la nota de crédito: sin eso no se puede reconstruir después.',
}

/** Cuánto queda por acreditar de una factura. Nunca negativo. */
export function saldoAcreditable(totalFactura: number, yaAcreditado: number): number {
  const resto = totalFactura - yaAcreditado
  return resto > 0 ? Math.round((resto + Number.EPSILON) * 100) / 100 : 0
}

/**
 * Por qué NO se puede emitir esta nota de crédito. `null` = se puede.
 *
 * Devuelve un motivo y no un booleano por lo mismo de siempre en este proyecto:
 * quien está en el mostrador necesita saber **qué** corregir, no que «no se
 * pudo».
 */
export function motivoNoAcreditar(p: {
  factura: { total: number; cae?: string | null } | null
  yaAcreditado: number
  monto: number
  motivo: string
}): MotivoNoAcreditar | null {
  if (!p.factura) return 'sin_factura'
  // Sin CAE el comprobante no llegó a ARCA: no hay qué revertir. Con el simulador
  // el CAE existe igual, así que esto no estorba la demostración.
  if (!p.factura.cae) return 'sin_cae'
  if (!(p.monto > 0)) return 'importe'
  if (p.motivo.trim().length < MOTIVO_NC_MINIMO) return 'motivo_corto'
  if (p.monto > saldoAcreditable(p.factura.total, p.yaAcreditado) + 0.001) return 'excede'
  return null
}
