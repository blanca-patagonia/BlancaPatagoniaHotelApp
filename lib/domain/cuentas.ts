/**
 * Cuentas corrientes de agencias / empresas (lógica pura).
 * Saldo = cargos − pagos. Positivo → la agencia adeuda al hotel.
 *
 * ⚠️ LA INVARIANTE, la misma que sostiene `pagos` (ADR 0027, migración 0067):
 *
 *     `movimientos_cuenta.monto` y `movimientos_proveedor.monto` están
 *     SIEMPRE en USD.
 *
 * `saldoCuenta` los suma sin mirar la moneda, así que un cargo de ARS 185.000
 * guardado ahí se sumaría como USD 185.000 y el saldo del socio quedaría cien
 * veces mal. El importe real del comprobante va en `monto_origen` + `moneda` +
 * `cotizacion`, y la migración 0078 tiene los `check` que lo obligan.
 */

export const TIPOS_CUENTA = ['agencia', 'empresa'] as const
export type TipoCuenta = (typeof TIPOS_CUENTA)[number]

export const ETIQUETAS_TIPO_CUENTA: Record<TipoCuenta, string> = {
  agencia: 'Agencia',
  empresa: 'Empresa',
}

export type TipoMovimiento = 'cargo' | 'pago'

export const ETIQUETAS_MOVIMIENTO: Record<TipoMovimiento, string> = {
  cargo: 'Cargo',
  pago: 'Pago',
}

export interface Movimiento {
  tipo: TipoMovimiento
  monto: number
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Saldo de la cuenta corriente (cargos − pagos). */
export function saldoCuenta(movimientos: Movimiento[]): number {
  return redondear(
    movimientos.reduce((acc, m) => acc + (m.tipo === 'cargo' ? m.monto : -m.monto), 0),
  )
}

/** Aplica el descuento de agencia a un importe. */
export function aplicarDescuento(monto: number, descuentoPct: number): number {
  return redondear(monto * (1 - descuentoPct / 100))
}

/* ─────────────────────────────────────────── moneda del movimiento ─────── */

/** Lo que hay que guardar de un movimiento cargado en moneda extranjera. */
export interface MovimientoEnMoneda {
  /** En USD. Es lo único que entra al saldo. */
  monto: number
  moneda: string
  /** En `moneda`, tal como figura en el comprobante. `null` si fue en USD. */
  montoOrigen: number | null
  /** USD → `moneda`, congelada. `null` si fue en USD. */
  cotizacion: number | null
}

/**
 * Convierte el importe que se cargó en pantalla a las cuatro columnas de la base.
 *
 * Quien carga escribe el número del comprobante —«185000», porque eso dice la
 * factura de la lavandería— y elige la moneda. Acá se traduce a la forma que la
 * base exige desde la 0078.
 *
 * Devuelve `null` cuando se pide una moneda extranjera sin cotización utilizable.
 * Es deliberado que no invente un valor de respaldo: un tipo de cambio inventado
 * mueve el saldo de un socio real, y esa diferencia después la discute alguien.
 * Quien llama tiene que ofrecer USD o esperar a que haya cotización.
 *
 * ⚠️ Se divide por la cotización (`monto local / venta`), no se multiplica: el
 * importe entra en moneda local y el saldo vive en dólares. Es la dirección
 * contraria a `calcularCobro` de `lib/domain/cobro.ts`, que parte de un saldo en
 * USD para pedirle a la pasarela un importe en pesos.
 */
export function movimientoEnMoneda(
  montoIngresado: number,
  moneda: string,
  cotizacion: number | null,
): MovimientoEnMoneda | null {
  if (!Number.isFinite(montoIngresado) || !(montoIngresado > 0)) return null

  if (moneda === 'USD') {
    return { monto: redondear(montoIngresado), moneda, montoOrigen: null, cotizacion: null }
  }

  if (cotizacion === null || !Number.isFinite(cotizacion) || !(cotizacion > 0)) return null

  const enUSD = redondear(montoIngresado / cotizacion)
  // Un importe tan chico que redondea a cero saldría del `check` de la base con
  // un error de restricción ilegible. Mejor rechazarlo acá.
  if (!(enUSD > 0)) return null

  return { monto: enUSD, moneda, montoOrigen: redondear(montoIngresado), cotizacion }
}
