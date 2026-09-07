/**
 * Traducción del comprobante del sistema al formato de **WSFEv1** de ARCA/AFIP
 * (lógica pura).
 *
 * ── Por qué existe este módulo, si el CAE todavía es simulado ───────────────
 *
 * `SolicitudCae` llevaba lo mínimo para que el simulador devolviera catorce
 * dígitos: tipo, punto de venta, número, total, neto, IVA y CUIT del receptor.
 * **Le faltaba casi todo lo que WSFEv1 exige de verdad** (auditoría 2026-09,
 * Bloque D): CUIT del emisor, `Concepto`, el arreglo `Iva` por alícuota, los
 * `Tributos`, la moneda y su cotización, y el tipo y número de documento del
 * receptor.
 *
 * Escribir eso el día que llegue el certificado, contra una API que rechaza el
 * comprobante entero por un campo, es la peor forma de descubrir estas reglas.
 * Acá están, puras y probadas, y el adapter real sólo tiene que serializarlas.
 *
 * ── Las tres trampas de este formato ────────────────────────────────────────
 *
 * 1. **Una estadía es un SERVICIO** (`Concepto = 2`), y con Concepto 2 o 3 son
 *    **obligatorios** `FchServDesde`, `FchServHasta` y `FchVtoPago`. Mandarlo
 *    como producto (1) para «simplificar» hace que el comprobante de un hotel
 *    declare algo que no es, y omitir esas fechas lo hace rechazar.
 * 2. **El consumidor final es `DocTipo = 99` con `DocNro = 0`.** No es 96 (DNI) ni
 *    ningún otro. ⚠️ Hay documentación de terceros circulando que dice `5`; es
 *    incorrecta, y verificarlo contra el manual oficial es lo que evita que el
 *    primer comprobante real se rechace.
 * 3. **La moneda es `PES`/`DOL`, no ISO 4217.** Y con `MonId` distinto de `PES`,
 *    `MonCotiz` es obligatorio y **no puede ser 1**: es la cotización del día.
 *
 * ⚠️ Esto **traduce**; no emite nada. Quien habla con ARCA es el adapter, que
 * todavía no existe porque necesita certificado (ADR 0012).
 */

import type { CondicionIva, TipoComprobante } from './facturacion'

/* ───────────────────────────────────── códigos de comprobante ──────────── */

/**
 * Código de comprobante de WSFEv1 según la letra y si es nota de crédito.
 *
 * ⚠️ Facturas y notas de crédito son **códigos distintos**, no una bandera: 1/6/11
 * contra 3/8/13. Un adapter que ignore la diferencia emitiría una **factura** por
 * el importe que se quería devolver — el error más caro posible en este módulo.
 */
export const CODIGO_COMPROBANTE: Record<TipoComprobante, { factura: number; notaCredito: number }> =
  {
    A: { factura: 1, notaCredito: 3 },
    B: { factura: 6, notaCredito: 8 },
    C: { factura: 11, notaCredito: 13 },
  }

export function codigoComprobante(tipo: TipoComprobante, esNotaCredito: boolean): number {
  const par = CODIGO_COMPROBANTE[tipo]
  return esNotaCredito ? par.notaCredito : par.factura
}

/* ──────────────────────────────────────────────────── concepto ─────────── */

export const CONCEPTO = {
  productos: 1,
  servicios: 2,
  productosYServicios: 3,
} as const

export type Concepto = (typeof CONCEPTO)[keyof typeof CONCEPTO]

/**
 * Qué concepto le corresponde a una factura del hotel.
 *
 * El alojamiento es un **servicio**. Cuando la cuenta además lleva consumos de
 * productos —frigobar, la botella de vino del punto de venta— el comprobante es
 * mixto (3). La diferencia no es cosmética: los tres códigos tienen distintas
 * reglas de fechas obligatorias.
 */
export function conceptoDeFactura(tieneProductos: boolean): Concepto {
  return tieneProductos ? CONCEPTO.productosYServicios : CONCEPTO.servicios
}

/** Con `Concepto` 2 o 3, las fechas del servicio son obligatorias. */
export function exigeFechasDeServicio(concepto: Concepto): boolean {
  return concepto === CONCEPTO.servicios || concepto === CONCEPTO.productosYServicios
}

/* ───────────────────────────────────────── documento del receptor ─────── */

export const DOC_TIPO = {
  cuit: 80,
  cuil: 86,
  dni: 96,
  /** ⚠️ Consumidor final. Va con `DocNro = 0`. NO es 5 ni 96. */
  consumidorFinal: 99,
} as const

export type DocTipo = (typeof DOC_TIPO)[keyof typeof DOC_TIPO]

export interface DocumentoReceptor {
  docTipo: DocTipo
  /** Sin guiones. `0` para consumidor final. */
  docNro: string
}

/**
 * Resuelve el documento del receptor.
 *
 * Con CUIT informado va CUIT (80), sea cual sea la condición: un responsable
 * inscripto **tiene** que ir identificado. Sin CUIT se cae a consumidor final
 * (99 / 0), que es lo que WSFEv1 espera para una factura B sin identificar.
 *
 * ⚠️ No se intenta adivinar un DNI a partir del documento del huésped. El sistema
 * guarda `doc_tipo`/`doc_numero` para el registro de pasajeros, y un pasaporte
 * extranjero ahí adentro **no** es un DNI: informarlo como 96 sería declarar un
 * documento argentino que no existe.
 */
export function documentoReceptor(
  cuitReceptor: string | null | undefined,
): DocumentoReceptor {
  const cuit = (cuitReceptor ?? '').replace(/\D/g, '')
  if (/^\d{11}$/.test(cuit)) return { docTipo: DOC_TIPO.cuit, docNro: cuit }
  return { docTipo: DOC_TIPO.consumidorFinal, docNro: '0' }
}

/* ────────────────────────────────────────────────── alícuotas de IVA ──── */

/**
 * Códigos de alícuota de ARCA.
 *
 * Son los que WSFEv1 acepta en el arreglo `Iva`. El alojamiento en Argentina
 * tributa al 21 %; algunos servicios van al 10,5 %.
 */
export const CODIGO_ALICUOTA: Record<number, number> = {
  0: 3,
  10.5: 4,
  21: 5,
  27: 6,
  5: 8,
  2.5: 9,
}

export function codigoAlicuota(pct: number): number | null {
  return CODIGO_ALICUOTA[pct] ?? null
}

export interface LineaIva {
  /** Código de alícuota de ARCA. */
  id: number
  /** Base imponible: el neto **gravado**, sin la parte exenta. */
  baseImp: number
  /** El impuesto de esa alícuota. */
  importe: number
}

/**
 * Arma el arreglo `Iva` del comprobante.
 *
 * ── Las dos reglas que importan ─────────────────────────────────────────────
 *
 * 1. **La base imponible NO es el neto: es el neto menos lo exento.** En este
 *    sistema `exento` es un subconjunto de `neto` y no un sumando (ADR 0024, y el
 *    `check` de la migración 0058 lo impone). Mandar el neto entero como base
 *    declararía IVA sobre una porción que la ley exime.
 * 2. **Un comprobante sin IVA discriminado no lleva arreglo `Iva`.** Las facturas
 *    B y C no lo discriminan (`discriminaIva`), y mandarlo igual es informar un
 *    impuesto que el comprobante no muestra.
 *
 * Devuelve vacío cuando no hay nada gravado: todo exento, o alícuota cero.
 */
export function lineasIva(entrada: {
  neto: number
  exento: number
  iva: number
  alicuota: number
}): LineaIva[] {
  const base = redondear(entrada.neto - entrada.exento)
  if (!(base > 0) || !(entrada.iva > 0)) return []

  const id = codigoAlicuota(entrada.alicuota)
  // Una alícuota que ARCA no conoce no se aproxima a la más cercana: se omite y
  // el comprobante sale sin discriminar, que es visiblemente incorrecto en vez de
  // sutilmente falso.
  if (id === null) return []

  return [{ id, baseImp: base, importe: redondear(entrada.iva) }]
}

/* ──────────────────────────────────────────────────────────── moneda ──── */

/** ISO 4217 → código de moneda de ARCA. */
export const MONEDA_ARCA: Record<string, string> = {
  ARS: 'PES',
  USD: 'DOL',
  EUR: '060',
  BRL: '012',
}

export function monedaArca(iso: string): string | null {
  return MONEDA_ARCA[iso.trim().toUpperCase()] ?? null
}

/**
 * Por qué la moneda del comprobante NO se puede informar. `null` = se puede.
 *
 * ⚠️ Con `MonId` distinto de `PES`, `MonCotiz` es obligatorio y **no puede ser 1**:
 * es la cotización del día. Un comprobante en dólares con cotización 1 declara que
 * el dólar vale un peso, y ARCA lo rechaza — o peor, lo acepta y queda mal.
 */
export type MotivoMonedaInvalida = 'desconocida' | 'sin_cotizacion' | 'cotizacion_uno'

export const MENSAJES_MONEDA_INVALIDA: Record<MotivoMonedaInvalida, string> = {
  desconocida: 'ARCA no tiene un código para esa moneda.',
  sin_cotizacion:
    'Un comprobante en moneda extranjera necesita la cotización del día: sin ella no se puede emitir.',
  cotizacion_uno:
    'La cotización de una moneda extranjera no puede ser 1: eso declararía que vale lo mismo que el peso.',
}

export function motivoMonedaInvalida(
  iso: string,
  cotizacion: number | null,
): MotivoMonedaInvalida | null {
  const codigo = monedaArca(iso)
  if (!codigo) return 'desconocida'
  if (codigo === 'PES') return null
  if (cotizacion === null || !Number.isFinite(cotizacion) || cotizacion <= 0) {
    return 'sin_cotizacion'
  }
  if (cotizacion === 1) return 'cotizacion_uno'
  return null
}

/* ────────────────────────────────────────────── el comprobante armado ──── */

export interface ComprobanteWsfev1 {
  /** CUIT del **emisor**: el hotel. */
  cuitEmisor: string
  /** Código de comprobante (1, 6, 11, 3, 8, 13…). */
  cbteTipo: number
  ptoVta: number
  /** WSFEv1 emite rangos; acá siempre es un comprobante, así que desde = hasta. */
  cbteDesde: number
  cbteHasta: number
  /** `yyyymmdd`. */
  cbteFch: string
  concepto: Concepto
  docTipo: DocTipo
  docNro: string
  impTotal: number
  /** Neto gravado: el neto **menos** lo exento. */
  impNeto: number
  /** Operaciones exentas (`ImpOpEx`). */
  impOpEx: number
  impIVA: number
  /** Conceptos no gravados. Hoy siempre 0: el hotel no los tiene. */
  impTotConc: number
  /** Otros tributos. Hoy siempre 0; ver el comentario de `armarComprobante`. */
  impTrib: number
  monId: string
  monCotiz: number
  iva: LineaIva[]
  /** Sólo con `Concepto` 2 o 3. `yyyymmdd`. */
  fchServDesde?: string
  fchServHasta?: string
  fchVtoPago?: string
  /** Comprobante que asocia una nota de crédito. */
  cbtesAsoc?: { tipo: number; ptoVta: number; nro: number }[]
}

export type MotivoNoArmable =
  | 'sin_cuit_emisor'
  | 'moneda'
  | 'sin_fechas_de_servicio'
  | 'sin_asociado'

export const MENSAJES_NO_ARMABLE: Record<MotivoNoArmable, string> = {
  sin_cuit_emisor:
    'Falta el CUIT del hotel. Sin el CUIT del emisor no se puede pedir un CAE.',
  moneda: 'La moneda del comprobante no se puede informar a ARCA.',
  sin_fechas_de_servicio:
    'Una factura de alojamiento es un servicio, y ARCA exige el período facturado. Faltan las fechas de la estadía.',
  sin_asociado:
    'Una nota de crédito tiene que decir qué comprobante corrige. Falta el número de la factura asociada.',
}

export interface EntradaComprobante {
  cuitEmisor: string | null
  tipo: TipoComprobante
  esNotaCredito: boolean
  puntoVenta: number
  numero: number
  /** `YYYY-MM-DD`. */
  fecha: string
  total: number
  neto: number
  exento: number
  iva: number
  alicuota: number
  discriminaIva: boolean
  cuitReceptor: string | null
  condicionReceptor: CondicionIva
  moneda: string
  cotizacion: number | null
  tieneProductos: boolean
  /** Período de la estadía, `YYYY-MM-DD`. Obligatorio: es un servicio. */
  servicioDesde: string | null
  servicioHasta: string | null
  /** Vencimiento del pago. Por omisión, la fecha del comprobante. */
  vencimientoPago?: string | null
  /** Número de la factura que corrige, si es nota de crédito. */
  numeroAsociado?: number | null
}

/**
 * Arma el comprobante, o dice por qué no se puede.
 *
 * Devolver el motivo en vez de lanzar permite que la pantalla lo explique **antes**
 * de gastar un número de comprobante: la numeración es correlativa y sin huecos por
 * exigencia fiscal, así que descubrir el problema después de reservar el número
 * deja un hueco que hay que justificar.
 */
export function armarComprobante(
  e: EntradaComprobante,
): { comprobante: ComprobanteWsfev1; motivo: null } | { comprobante: null; motivo: MotivoNoArmable } {
  const cuitEmisor = (e.cuitEmisor ?? '').replace(/\D/g, '')
  if (!/^\d{11}$/.test(cuitEmisor)) return { comprobante: null, motivo: 'sin_cuit_emisor' }

  if (motivoMonedaInvalida(e.moneda, e.cotizacion)) {
    return { comprobante: null, motivo: 'moneda' }
  }

  const concepto = conceptoDeFactura(e.tieneProductos)
  if (exigeFechasDeServicio(concepto) && !(e.servicioDesde && e.servicioHasta)) {
    return { comprobante: null, motivo: 'sin_fechas_de_servicio' }
  }

  if (e.esNotaCredito && !e.numeroAsociado) {
    return { comprobante: null, motivo: 'sin_asociado' }
  }

  const monId = monedaArca(e.moneda) as string
  const base = redondear(e.neto - e.exento)

  const comprobante: ComprobanteWsfev1 = {
    cuitEmisor,
    cbteTipo: codigoComprobante(e.tipo, e.esNotaCredito),
    ptoVta: e.puntoVenta,
    cbteDesde: e.numero,
    cbteHasta: e.numero,
    cbteFch: aAaaammdd(e.fecha),
    concepto,
    ...documentoReceptor(e.cuitReceptor),
    impTotal: redondear(e.total),
    impNeto: base,
    impOpEx: redondear(e.exento),
    // En un comprobante que no discrimina (B y C), el IVA no se informa aparte
    // aunque el sistema lo tenga calculado para su propio desglose.
    impIVA: e.discriminaIva ? redondear(e.iva) : 0,
    // El hotel no tiene conceptos no gravados ni otros tributos (ingresos brutos
    // se percibe, no se factura acá). Se dejan explícitos en cero en vez de
    // omitirlos: WSFEv1 los espera, y un campo ausente y uno en cero no son lo
    // mismo para su validación.
    impTotConc: 0,
    impTrib: 0,
    monId,
    monCotiz: monId === 'PES' ? 1 : (e.cotizacion as number),
    iva: e.discriminaIva ? lineasIva(e) : [],
  }

  if (exigeFechasDeServicio(concepto)) {
    comprobante.fchServDesde = aAaaammdd(e.servicioDesde as string)
    comprobante.fchServHasta = aAaaammdd(e.servicioHasta as string)
    // Vencimiento del pago: por omisión, la fecha del comprobante. ARCA exige que
    // sea igual o posterior, así que la del comprobante siempre es válida.
    comprobante.fchVtoPago = aAaaammdd(e.vencimientoPago ?? e.fecha)
  }

  if (e.esNotaCredito) {
    comprobante.cbtesAsoc = [
      {
        // La nota A asocia una factura A: el par de códigos sale de la misma tabla.
        tipo: codigoComprobante(e.tipo, false),
        ptoVta: e.puntoVenta,
        nro: e.numeroAsociado as number,
      },
    ]
  }

  return { comprobante, motivo: null }
}

/* ───────────────────────────────────────────────────────── auxiliares ──── */

/** `2026-09-07` → `20260907`, que es el formato de fecha de WSFEv1. */
export function aAaaammdd(iso: string): string {
  return iso.replace(/-/g, '')
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * ¿Cierra la aritmética del comprobante?
 *
 * `ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpIVA + ImpTrib`. ARCA rechaza el
 * comprobante entero si no da, y el mensaje de error no dice cuál de los cinco
 * está mal. Comprobarlo antes de mandarlo convierte un rechazo opaco en algo que
 * se puede depurar acá.
 */
export function cierraElTotal(c: ComprobanteWsfev1): boolean {
  const suma = redondear(c.impTotConc + c.impNeto + c.impOpEx + c.impIVA + c.impTrib)
  return Math.round(suma * 100) === Math.round(c.impTotal * 100)
}
