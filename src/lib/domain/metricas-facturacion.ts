/**
 * Métricas de facturación por período (lógica pura).
 *
 * Separado de `metricas.ts` (ocupación/ADR/RevPAR) porque mide otra cosa —
 * plata facturada y cobrada, no noches— aunque comparta la misma forma de
 * ventana `[inicio, fin)` para poder reusar `metricasDeMes`/`metricasDeSemana`
 * como referencia de período en la pantalla del informe.
 */

import { fechaDelHotel } from '@/lib/fechas'
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
    // El día del HOTEL: cortar el `timestamptz` (UTC) contaba en el mes siguiente
    // lo emitido el último día después de las 21:00 (ver `fechaDelHotel`).
    const fecha = fechaDelHotel(f.emitida_en)
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
    const fecha = fechaDelHotel(p.creado_en)
    if (fecha < ventana.inicio || fecha >= ventana.fin) continue
    porMedio.set(p.medio, (porMedio.get(p.medio) ?? 0) + Number(p.monto))
  }
  return [...porMedio.entries()]
    .map(([medio, monto]) => ({ medio: medio as MedioPago, monto }))
    .sort((a, b) => b.monto - a.monto)
}
