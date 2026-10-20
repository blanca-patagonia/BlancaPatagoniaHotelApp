/**
 * Gastos operativos del hotel sin factura formal de proveedor (migración 0092).
 *
 * Patrón de referencia: el módulo de gastos de Invoice Ninja, adaptado —
 * `proveedores` ya cubre las facturas con contraparte; esto es para lo que no
 * tiene una: sueldos, servicios, caja chica.
 */

export const CATEGORIAS_GASTO = [
  'sueldos',
  'servicios',
  'mantenimiento',
  'impuestos',
  'insumos',
  'otro',
] as const

export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number]

export const ETIQUETAS_CATEGORIA_GASTO: Record<CategoriaGasto, string> = {
  sueldos: 'Sueldos',
  servicios: 'Servicios (luz, gas, internet)',
  mantenimiento: 'Mantenimiento',
  impuestos: 'Impuestos y tasas',
  insumos: 'Insumos',
  otro: 'Otro',
}

export interface DatosGasto {
  categoria: string
  descripcion: string
  monto: number
}

/**
 * Valida el alta de un gasto. Devuelve el mensaje del primer problema, o
 * `null` si está todo bien — mismo contrato que el resto de los validadores
 * puros del dominio (ver `lib/domain/cuenta.ts`).
 */
export function validarGasto(datos: DatosGasto): string | null {
  if (!(CATEGORIAS_GASTO as readonly string[]).includes(datos.categoria)) {
    return 'Elegí una categoría válida.'
  }
  if (datos.descripcion.trim().length === 0) {
    return 'La descripción no puede estar vacía.'
  }
  if (!Number.isFinite(datos.monto) || datos.monto <= 0) {
    return 'El monto tiene que ser mayor a cero.'
  }
  return null
}

export interface GastoConMonto {
  categoria: CategoriaGasto
  monto: number
}

/** Total por categoría, para el resumen del listado. */
export function totalPorCategoria(
  gastos: readonly GastoConMonto[],
): Record<CategoriaGasto, number> {
  const totales = Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c, 0])) as Record<
    CategoriaGasto,
    number
  >
  for (const g of gastos) totales[g.categoria] += g.monto
  return totales
}
