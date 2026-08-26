/**
 * Cobro en línea: conversión de moneda y catálogo de medios (lógica pura).
 *
 * Por qué existe este módulo, y no está todo en `pagos.ts`.
 *
 * `pagos.ts` responde «¿cuánto se pagó y cuánto falta?» sobre pagos ya
 * registrados. Esto responde «¿cuánto hay que cobrarle, en qué moneda y por
 * dónde?» antes de que exista el pago. Son dos preguntas distintas y la segunda
 * es la que trae el riesgo: el hotel es internacional y cobra en dos monedas
 * contra una reserva que está en una sola.
 *
 * ⚠️ LA INVARIANTE QUE SOSTIENE TODO ESTO:
 *
 *     `pagos.monto` está SIEMPRE en USD.
 *
 * `resumenPagos` suma esa columna para decidir si la reserva quedó saldada, y
 * no mira la moneda. Si un cobro en pesos se guardara con `monto = 350000`, la
 * reserva se daría por pagada al instante y el huésped se iría sin pagar. El
 * importe que de verdad pasó por la pasarela va en `monto_cobrado` + `moneda` +
 * `cotizacion`, y la migración 0067 tiene los `check` que lo obligan.
 */

import type { MonedaExtranjera } from './divisas'
import type { MedioPago } from './pagos'
import type { EstadoReserva } from './reservas'

/** Moneda base del sistema (ADR 0003). Todo saldo se mide acá. */
export const MONEDA_BASE = 'USD' as const

/** Cualquier moneda en la que el sistema sabe cobrar. */
export type MonedaCobro = typeof MONEDA_BASE | MonedaExtranjera

/* ─────────────────────────────────────────────────── conversión ────────── */

/** Dos decimales, sin el error de coma flotante de `toFixed`. */
function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Lo que hay que guardar de un cobro: el importe que salda (USD) y el que
 * efectivamente se le pide a la pasarela.
 */
export interface Cobro {
  /** En USD. Es lo que salda la reserva. */
  monto: number
  moneda: MonedaCobro
  /** En `moneda`. Es lo que el huésped ve en su resumen de tarjeta. */
  montoCobrado: number
  /** USD → `moneda`. Vale 1 cuando se cobra en dólares. */
  cotizacion: number
}

/**
 * Arma el cobro a partir del saldo en USD.
 *
 * La cotización se **congela acá**: la de hoy no explica un cobro de la semana
 * pasada, y sin ella el importe en dólares que saldó la reserva queda sin
 * justificación ante una auditoría.
 *
 * Devuelve `null` cuando se pide cobrar en moneda extranjera sin una cotización
 * utilizable. Es deliberado que no invente un valor de respaldo: cobrar a un
 * tipo de cambio inventado es cobrarle de más o de menos a alguien real. Quien
 * llama tiene que ofrecer USD o esperar a que haya cotización.
 */
export function calcularCobro(
  montoUSD: number,
  moneda: MonedaCobro,
  cotizacion: number | null,
): Cobro | null {
  if (!(montoUSD > 0) || !Number.isFinite(montoUSD)) return null

  if (moneda === MONEDA_BASE) {
    const monto = redondear(montoUSD)
    return { monto, moneda, montoCobrado: monto, cotizacion: 1 }
  }

  if (cotizacion === null || !(cotizacion > 0) || !Number.isFinite(cotizacion)) return null

  return {
    monto: redondear(montoUSD),
    moneda,
    montoCobrado: redondear(montoUSD * cotizacion),
    cotizacion,
  }
}

/**
 * Vuelve de la moneda de la pasarela a USD.
 *
 * Se usa cuando llega un pago que el sistema no originó —alguien cobró desde el
 * panel de la pasarela— y hay que imputarlo igual. Nunca para un pago propio: en
 * ése el importe en USD ya se decidió al crear el link, y recalcularlo con otra
 * cotización lo movería.
 */
export function imputarEnUSD(montoCobrado: number, cotizacion: number): number | null {
  if (!(montoCobrado > 0) || !(cotizacion > 0)) return null
  if (!Number.isFinite(montoCobrado) || !Number.isFinite(cotizacion)) return null
  return redondear(montoCobrado / cotizacion)
}

/**
 * ¿El importe que informa la pasarela es el que se le pidió?
 *
 * Se compara contra lo que el sistema registró al crear el link, no contra el
 * saldo de hoy: entre una cosa y la otra pueden haberse cargado consumos.
 *
 * La comparación es **exacta al centavo**, no por tolerancia. La pasarela cobra
 * exactamente el número que se le mandó, así que cualquier diferencia real es
 * una anomalía —un link manipulado, un evento de otra reserva, una integración
 * mal configurada— y corresponde revisarla a mano en vez de saldar la reserva.
 *
 * Se comparan centavos enteros y no `Math.abs(a - b) <= 0.01`, porque esa forma
 * hereda el error de coma flotante que quiere evitar: `145.21 - 145.20` da
 * `0.010000000000019`, que es mayor que `0.01`, así que dos importes separados
 * por exactamente un centavo daban «distintos» y dos idénticos podían dar
 * «iguales» por el otro lado. Redondear primero y comparar enteros no tiene ese
 * problema.
 */
export function coincideElImporte(esperado: number, recibido: number): boolean {
  if (!Number.isFinite(esperado) || !Number.isFinite(recibido)) return false
  return Math.round(esperado * 100) === Math.round(recibido * 100)
}

/* ───────────────────────────────────── catálogo de medios ──────────────── */

/**
 * Una forma de pagar, tal como se le ofrece al huésped.
 *
 * El hotel es internacional y eso define el catálogo: el huésped de afuera
 * necesita pagar con su tarjeta internacional en dólares, y el de acá necesita
 * pesos, cuotas, billetera virtual y efectivo en Rapipago. Ninguna pasarela
 * cubre bien las dos cosas, así que se ofrecen las dos y elige el huésped.
 */
export interface MedioDeCobro {
  /** Coincide con el nombre del proveedor en `lib/payments`. */
  id: MedioPago
  moneda: MonedaCobro
  titulo: string
  /** Para quién es. Lo lee alguien que está por pagar y duda. */
  detalle: string
  /** Con qué se puede pagar por acá. Se muestra tal cual. */
  formas: string[]
}

/**
 * Los medios en línea, en el orden en que se muestran.
 *
 * Que un medio esté acá **no significa que esté disponible**: eso lo decide
 * `PAGO_PROVIDER` (qué pasarelas contrató el hotel) y, para las que cobran en
 * moneda extranjera, que haya cotización vigente. El catálogo describe la
 * oferta posible; la pantalla muestra la intersección con lo que de verdad hay.
 */
export const MEDIOS_DE_COBRO: readonly MedioDeCobro[] = [
  {
    id: 'stripe',
    moneda: 'USD',
    titulo: 'Tarjeta internacional',
    detalle: 'Para huéspedes del exterior. Se cobra en dólares, sin conversión.',
    formas: ['Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay'],
  },
  {
    id: 'mercadopago',
    moneda: 'ARS',
    titulo: 'MercadoPago y medios locales',
    detalle: 'Para pagar en pesos argentinos, con o sin cuotas.',
    formas: [
      'Tarjeta de crédito',
      'Tarjeta de débito',
      'Dinero en MercadoPago',
      'Efectivo (Rapipago y Pago Fácil)',
    ],
  },
]

/** El medio de cobro con ese id, o `null` si no existe. */
export function medioDeCobro(id: string): MedioDeCobro | null {
  return MEDIOS_DE_COBRO.find((m) => m.id === id) ?? null
}

/* ────────────────────────────────────────── vigencia del link ──────────── */

/**
 * Cuántas horas vive un link de pago.
 *
 * Tiene que ser cómodo para el huésped que lo abre al día siguiente, y corto
 * frente a lo que protege: cada reserva pendiente bloquea una unidad 5 días
 * (ver `LIMITES.reserva_publica`). Un link que sobreviva a la reserva puede
 * cobrar una seña de algo que ya se canceló y se volvió a vender, y devolver esa
 * plata es un trámite manual con la pasarela.
 *
 * 48 horas entra cómodo dentro de esos 5 días y cubre un fin de semana.
 */
export const HORAS_VIGENCIA_LINK = 48

/** Cuándo vence un link creado en `desde`. */
export function vencimientoDelLink(desde: Date): Date {
  return new Date(desde.getTime() + HORAS_VIGENCIA_LINK * 60 * 60 * 1000)
}

/** ¿Este link todavía sirve? Uno sin vencimiento se considera vivo. */
export function linkVigente(venceEn: string | null, ahora: Date): boolean {
  if (!venceEn) return true
  const vence = new Date(venceEn)
  if (Number.isNaN(vence.getTime())) return true
  return vence.getTime() > ahora.getTime()
}

/* ─────────────────────────────────────── ¿se le puede cobrar? ──────────── */

/**
 * Por qué NO se le puede generar un cobro a esta reserva. `null` = se puede.
 *
 * Se devuelve el motivo y no un booleano por la misma razón que en
 * `motivoGarantiaNoSirve`: un botón que simplemente no está deja a quien lo
 * busca sin saber qué hacer. El texto sale de acá para que la pantalla del
 * huésped y la del mostrador digan lo mismo.
 */
export function motivoNoSeCobra(estado: EstadoReserva, saldo: number): string | null {
  if (estado === 'cancelada') {
    return 'La reserva está cancelada. Si corresponde cobrar una penalidad, se registra a mano desde el mostrador.'
  }
  if (!(saldo > 0)) {
    return 'La reserva no tiene saldo pendiente.'
  }
  return null
}
