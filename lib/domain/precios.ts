/**
 * Motor de precios (lógica pura, sin acoplar a la base de datos ni a la UI).
 *
 * El Tarifario distingue dos precios por (tipo × temporada):
 *  - `precioNeto`  → canal agencia.
 *  - `precioRack`  → canal mostrador / directo.
 * Los montos del tarifario son SIN IVA ("IVA discriminado"); el IVA se calcula
 * sobre el neto (21 % por defecto; los turistas extranjeros pueden estar exentos,
 * lo que se resuelve en la facturación — Fase 5).
 */

export type TarifaTipo = 'neto' | 'rack'

/** Tarifa vigente de un tipo de unidad en una temporada. */
export interface Tarifa {
  precioNeto: number
  precioRack: number
  ivaPct: number
}

/** Una noche ya tarifada (permite estadías que cruzan temporadas). */
export interface NocheTarifada {
  fecha: string // ISO yyyy-mm-dd
  precio: number // por noche, según el canal, sin IVA
  ivaPct: number
}

export interface Promocion {
  tipo: 'porcentaje' | 'monto' | 'paquete'
  valor: number
  condiciones?: {
    min_noches?: number
    anticipacion_dias?: number
  }
}

export interface ResumenPrecio {
  noches: number
  subtotalNeto: number // sin IVA, antes de promoción
  descuento: number // sobre el neto
  totalNeto: number // sin IVA, después de promoción
  iva: number
  total: number // con IVA
}

/** Precio por noche según el canal de venta. */
export function precioPorNoche(tarifa: Tarifa, tarifaTipo: TarifaTipo): number {
  return tarifaTipo === 'neto' ? tarifa.precioNeto : tarifa.precioRack
}

/** Redondeo a 2 decimales evitando errores de coma flotante. */
function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** ¿La promoción cumple sus condiciones para esta estadía? */
export function promocionAplica(
  promo: Promocion,
  noches: number,
  anticipacionDias = 0,
): boolean {
  const c = promo.condiciones ?? {}
  if (c.min_noches != null && noches < c.min_noches) return false
  if (c.anticipacion_dias != null && anticipacionDias < c.anticipacion_dias) return false
  return true
}

/**
 * Calcula el precio total de una estadía a partir de sus noches tarifadas.
 * Las promociones de tipo `paquete` no ajustan el precio aquí (se cotizan con
 * sus servicios asociados en la Fase 5).
 */
export function calcularEstadia(params: {
  noches: NocheTarifada[]
  promocion?: Promocion | null
  anticipacionDias?: number
}): ResumenPrecio {
  const { noches, promocion, anticipacionDias = 0 } = params

  const subtotalNeto = redondear(noches.reduce((acc, n) => acc + n.precio, 0))

  let descuento = 0
  if (
    promocion &&
    promocion.tipo !== 'paquete' &&
    promocionAplica(promocion, noches.length, anticipacionDias)
  ) {
    descuento =
      promocion.tipo === 'porcentaje'
        ? subtotalNeto * (promocion.valor / 100)
        : Math.min(promocion.valor, subtotalNeto)
  }
  descuento = redondear(descuento)

  const totalNeto = redondear(subtotalNeto - descuento)

  // IVA proporcional al neto de cada noche, aplicado tras el descuento.
  const factorDescuento = subtotalNeto > 0 ? totalNeto / subtotalNeto : 0
  const iva = redondear(
    noches.reduce((acc, n) => acc + n.precio * factorDescuento * (n.ivaPct / 100), 0),
  )

  return {
    noches: noches.length,
    subtotalNeto,
    descuento,
    totalNeto,
    iva,
    total: redondear(totalNeto + iva),
  }
}
