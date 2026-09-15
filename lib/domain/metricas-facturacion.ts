/**
 * Métricas de facturación por período (lógica pura).
 *
 * Separado de `metricas.ts` (ocupación/ADR/RevPAR) porque mide otra cosa —
 * plata facturada y cobrada, no noches— aunque comparta la misma forma de
 * ventana `[inicio, fin)` para poder reusar `metricasDeMes`/`metricasDeSemana`
 * como referencia de período en la pantalla del informe.
 */

import type { MedioPago } from './pagos'

export interface FacturaMetrica {
  total: number | string
  emitida_en: string
}

export interface PagoMetrica {
  medio: string
  monto: number | string
  creado_en: string
}

/** Total facturado dentro de la ventana `[inicio, fin)`, por fecha de emisión. */
export function facturadoEnPeriodo(
  facturas: readonly FacturaMetrica[],
  ventana: { inicio: string; fin: string },
): number {
  let total = 0
  for (const f of facturas) {
    const fecha = f.emitida_en.slice(0, 10)
    if (fecha >= ventana.inicio && fecha < ventana.fin) total += Number(f.total)
  }
  return total
}

/** Cobrado dentro de la ventana, agrupado por medio de pago. Solo trae los medios con algo cobrado. */
export function cobradoPorMedioEnPeriodo(
  pagos: readonly PagoMetrica[],
  ventana: { inicio: string; fin: string },
): { medio: MedioPago; monto: number }[] {
  const porMedio = new Map<string, number>()
  for (const p of pagos) {
    const fecha = p.creado_en.slice(0, 10)
    if (fecha < ventana.inicio || fecha >= ventana.fin) continue
    porMedio.set(p.medio, (porMedio.get(p.medio) ?? 0) + Number(p.monto))
  }
  return [...porMedio.entries()]
    .map(([medio, monto]) => ({ medio: medio as MedioPago, monto }))
    .sort((a, b) => b.monto - a.monto)
}
