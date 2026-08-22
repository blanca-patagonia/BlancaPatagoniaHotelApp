import { detectarDiscrepancia } from './canales'

/**
 * Lo que le cuesta al hotel vender por un canal.
 *
 * ── Por qué existe este módulo ───────────────────────────────────────────────
 *
 * La comisión entraba al sistema y no llegaba a ninguna cuenta. Se leía del
 * informe del extranet, se guardaba en `canal_reservas.comision`, se mostraba en
 * una columna de la pantalla… y ahí moría: `importarEntrante` **ni la
 * seleccionaba**. Con eso no se podía responder la pregunta que decide si el canal
 * conviene: *cuánto me dejó Booking neto de comisión*.
 *
 * Este módulo son las reglas de esa cuenta, puras y testeables sin base.
 *
 * ── El error que hay que no cometer ─────────────────────────────────────────
 *
 * `reservas.tarifa_tipo = 'neto'` (ADR 0004) es un **tipo de tarifa** —la de
 * agencia, contra la `rack` de mostrador— y **no** significa «importe al que ya se
 * le descontó la comisión». Son dos cosas distintas que comparten una palabra:
 *
 *     total de la reserva  = lo que paga el huésped   (con IVA, ADR 0004)
 *     comisión             = lo que se queda el canal (gasto del hotel)
 *     neto de comisión     = total − comisión
 *
 * Restarle la comisión a un total que alguien creyó «ya neto» da un número más bajo
 * que el real, y **no falla**: se publica como si estuviera bien. Por eso
 * `netoDeComision` recibe el total y la comisión por separado y no acepta un
 * «total ya neto».
 */

/** Conceptos por los que un canal genera un cargo o un ingreso. */
export const CONCEPTOS_CARGO = [
  'comision',
  'payout',
  'ajuste',
  'impuesto_canal',
  'marketing',
] as const
export type ConceptoCargo = (typeof CONCEPTOS_CARGO)[number]

export const ETIQUETAS_CONCEPTO: Record<ConceptoCargo, string> = {
  comision: 'Comisión',
  payout: 'Liquidación',
  ajuste: 'Ajuste',
  impuesto_canal: 'Impuesto del canal',
  marketing: 'Marketing',
}

/**
 * De dónde salió el dato.
 *
 * ⚠️ Esto **entra en la clave de idempotencia**, y es la decisión central del
 * módulo. La misma reserva puede tener dos filas de comisión: la que informó el
 * archivo de reservas y la que después cobró la factura mensual. No se pisan: se
 * guardan las dos y se comparan. Si se pisaran, la conciliación —que es todo el
 * punto— sería imposible, porque el dato viejo ya no estaría.
 */
export const ORIGENES_CARGO = [
  'informe_reservas',
  'factura_comision',
  'liquidacion',
  'manual',
] as const
export type OrigenCargo = (typeof ORIGENES_CARGO)[number]

export const ETIQUETAS_ORIGEN: Record<OrigenCargo, string> = {
  informe_reservas: 'Informe de reservas',
  factura_comision: 'Factura de comisión',
  liquidacion: 'Liquidación',
  manual: 'Carga manual',
}

/** Estado de conciliación de un cargo. */
export const ESTADOS_CONCILIACION = ['devengado', 'conciliado', 'en_disputa'] as const
export type EstadoConciliacion = (typeof ESTADOS_CONCILIACION)[number]

export const ETIQUETAS_CONCILIACION: Record<EstadoConciliacion, string> = {
  devengado: 'Devengado',
  conciliado: 'Conciliado',
  en_disputa: 'En disputa',
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/* ────────────────────────────────────────────────── devengo por reserva ──── */

export interface CargoDevengado {
  concepto: ConceptoCargo
  origen: OrigenCargo
  monto: number
  moneda: string
  /** Idempotencia: la misma reserva y el mismo origen no se devengan dos veces. */
  claveIdempotencia: string
}

/**
 * Arma el cargo de comisión de una reserva del canal.
 *
 * Devuelve `null` cuando **no hay nada que devengar**, y hay tres casos distintos
 * que llevan al mismo lugar por razones distintas:
 *
 * · El canal no informó comisión (`null`). El feed iCal nunca la trae, así que esto
 *   es lo normal en ese camino. Devengar cero sería afirmar que Booking no cobró
 *   nada, que es falso; dejarlo sin devengar deja la reserva contada en «comisión
 *   sin informar», que es la verdad.
 * · La comisión es cero. Puede ser real —una cancelación sin cargo— y en ese caso
 *   no hay asiento que hacer.
 * · La reserva está cancelada. La comisión de una cancelada la define la política
 *   del canal y puede ser cero, parcial o total: **no se adivina**. Si la factura
 *   después la cobra, entra por `factura_comision` y aparece como «línea de factura
 *   sin devengo», que es exactamente la señal que hay que mirar.
 */
export function devengarComision(entrada: {
  comision: number | null | undefined
  monedaCanal: string
  operacion: 'nueva' | 'modificada' | 'cancelada'
  externalId: string
}): CargoDevengado | null {
  if (entrada.operacion === 'cancelada') return null
  if (entrada.comision === null || entrada.comision === undefined) return null

  const monto = redondear(entrada.comision)
  if (monto <= 0) return null

  return {
    concepto: 'comision',
    origen: 'informe_reservas',
    monto,
    moneda: entrada.monedaCanal || 'USD',
    claveIdempotencia: claveDeCargo('informe_reservas', 'comision', entrada.externalId),
  }
}

/**
 * Clave de idempotencia de un cargo.
 *
 * El origen va **adentro** de la clave a propósito (ver `ORIGENES_CARGO`): dos
 * filas del mismo concepto y la misma reserva tienen que poder convivir si vinieron
 * de fuentes distintas.
 */
export function claveDeCargo(
  origen: OrigenCargo,
  concepto: ConceptoCargo,
  referencia: string,
): string {
  return `${origen}:${concepto}:${referencia}`
}

/* ─────────────────────────────────────────────────────── neto y márgenes ──── */

/**
 * Lo que le queda al hotel de una reserva después de la comisión del canal.
 *
 * `total` es lo que paga el huésped (con IVA, ADR 0004) y `comision` es el gasto.
 * Ver la advertencia del encabezado: `tarifa_tipo = 'neto'` **no** quiere decir que
 * el total ya venga sin comisión.
 */
export function netoDeComision(total: number, comision: number | null | undefined): number {
  return redondear(total - (comision ?? 0))
}

/**
 * Comisión efectiva sobre el bruto, en porcentaje.
 *
 * Es el número que revela si el canal cobra el porcentaje pactado o otro: una
 * comisión efectiva del 18 % contra un 15 % acordado son tres puntos que nadie
 * estaba mirando.
 *
 * Devuelve `null` si el bruto es cero o negativo. **No devuelve 0**: un
 * denominador inválido no es «comisión del cero por ciento», y mostrarlo como 0 %
 * haría creer que el canal no cobra nada.
 */
export function comisionEfectivaPct(bruto: number, comision: number): number | null {
  if (!(bruto > 0)) return null
  return redondear((comision / bruto) * 100)
}

/* ───────────────────────────────────────────────────────── conciliación ──── */

export interface ResultadoConciliacion {
  devengado: number
  facturado: number
  diferencia: number
  cierra: boolean
  /** Texto para la pantalla. Vacío si cierra. */
  detalle: string
}

/**
 * Compara lo devengado en el período contra lo que factura el canal.
 *
 * Reusa `detectarDiscrepancia` con su tolerancia, en vez de inventar otra regla de
 * redondeo: ya resuelve el mismo problema —dos importes que deberían coincidir y
 * difieren por centavos de conversión— y tener dos toleranias distintas en el mismo
 * módulo de plata es cómo aparecen los números que no cierran entre pantallas.
 *
 * Ojo con el orden de los argumentos de `detectarDiscrepancia(propio, canal)`: acá
 * lo «propio» es lo devengado y lo «del canal» es lo facturado, así que una
 * diferencia positiva significa que **el canal factura más de lo que devengamos**.
 */
export function conciliarDevengoContraFactura(
  devengado: number,
  facturado: number,
  tolerancia = 0.5,
): ResultadoConciliacion {
  const d = detectarDiscrepancia(devengado, facturado, tolerancia)

  return {
    devengado: redondear(devengado),
    facturado: redondear(facturado),
    diferencia: d.diferencia,
    cierra: !d.hay,
    detalle: d.hay
      ? `La factura del canal difiere ${Math.abs(d.diferencia).toFixed(2)} de lo devengado ` +
        `(devengado ${redondear(devengado).toFixed(2)} · facturado ${redondear(facturado).toFixed(2)}). ` +
        `Revisá las reservas que no cierran antes de registrar el comprobante.`
      : '',
  }
}

/* ──────────────────────────────────────────────── el neto que sí se puede ──── */

export interface NetoDelPeriodo {
  bruto: number
  comision: number
  neto: number
  comisionPct: number | null
  reservas: number
  /**
   * Cuántas reservas del período **no informaron comisión**.
   *
   * Se cuentan aparte y no se tratan como cero: el neto de un período con 8
   * reservas sin comisión informada está incompleto, y presentarlo como definitivo
   * sería el mismo error que sumar cero. La pantalla tiene que poder decir «el neto
   * es al menos esto, y faltan 8 por informar».
   */
  sinComisionInformada: number
}

/**
 * Consolida el bruto, la comisión y el neto de un conjunto de reservas del canal.
 *
 * `comision: null` **no** se cuenta como cero: se suma a `sinComisionInformada`.
 */
export function netoDelPeriodo(
  filas: readonly { total: number; comision: number | null | undefined }[],
): NetoDelPeriodo {
  let bruto = 0
  let comision = 0
  let sinComisionInformada = 0

  for (const f of filas) {
    bruto += f.total
    if (f.comision === null || f.comision === undefined) sinComisionInformada++
    else comision += f.comision
  }

  bruto = redondear(bruto)
  comision = redondear(comision)

  return {
    bruto,
    comision,
    neto: redondear(bruto - comision),
    comisionPct: comisionEfectivaPct(bruto, comision),
    reservas: filas.length,
    sinComisionInformada,
  }
}
