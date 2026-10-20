/**
 * Dominio de consumos y cuenta consolidada (lógica pura).
 * La cuenta de una reserva = alojamiento + consumos extra.
 */

export const CATEGORIAS_PRODUCTO = ['desayuno', 'frigobar', 'excursion', 'traslado', 'otro'] as const
export type CategoriaProducto = (typeof CATEGORIAS_PRODUCTO)[number]

export const ETIQUETAS_CATEGORIA_PRODUCTO: Record<CategoriaProducto, string> = {
  desayuno: 'Desayuno',
  frigobar: 'Frigobar',
  excursion: 'Excursión',
  traslado: 'Traslado',
  otro: 'Otro',
}

export interface Consumo {
  cantidad: number
  precioUnitario: number
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function subtotalConsumo(c: Consumo): number {
  return redondear(c.cantidad * c.precioUnitario)
}

export function totalConsumos(consumos: Consumo[]): number {
  return redondear(consumos.reduce((acc, c) => acc + c.cantidad * c.precioUnitario, 0))
}

export interface CuentaConsolidada {
  alojamiento: number
  consumos: number
  total: number
}

export function cuentaConsolidada(alojamiento: number, consumos: Consumo[]): CuentaConsolidada {
  const c = totalConsumos(consumos)
  return {
    alojamiento: redondear(alojamiento),
    consumos: c,
    total: redondear(alojamiento + c),
  }
}
