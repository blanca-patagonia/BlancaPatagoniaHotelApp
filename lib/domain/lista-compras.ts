/**
 * Lista de compras de cocina (lógica pura).
 *
 * Qué es y qué no es: una lista de trabajo para ir anotando, con el tiempo,
 * qué hay que comprarle al supermercado para el restaurante — no el catálogo
 * de venta al huésped (`productos_servicios`) ni un gasto ya facturado
 * (`movimientos_proveedor`). El precio es una estimación para presupuestar la
 * compra, no un importe fiscal: por eso puede faltar, y por eso no se valida
 * como los importes de `pagos`/`facturas`.
 */

export interface ItemListaCompras {
  precioEstimado: number | null
  comprado: boolean
}

/** Suma de lo estimado, entre los ítems todavía no comprados. Lo que falta gastar. */
export function totalPendiente(items: readonly ItemListaCompras[]): number {
  return items
    .filter((i) => !i.comprado)
    .reduce((acc, i) => acc + (i.precioEstimado ?? 0), 0)
}

/** Suma de lo estimado, entre los ítems ya comprados. Referencia de lo gastado en esta tanda. */
export function totalComprado(items: readonly ItemListaCompras[]): number {
  return items
    .filter((i) => i.comprado)
    .reduce((acc, i) => acc + (i.precioEstimado ?? 0), 0)
}

/** Cuántos ítems quedan por comprar. */
export function cantidadPendiente(items: readonly ItemListaCompras[]): number {
  return items.filter((i) => !i.comprado).length
}
