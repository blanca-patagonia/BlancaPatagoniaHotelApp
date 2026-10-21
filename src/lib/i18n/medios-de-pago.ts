import type { OpcionDePago } from '@/lib/payments/opciones'
import type { Diccionario } from './diccionarios/es'
import { rellenar } from './index'

/** Un medio de pago listo para mostrar: textos en el idioma de la pantalla. */
export interface MedioTraducido {
  /** Lo que viaja como `medio`: el nombre de la pasarela en `PAGO_PROVIDER`. */
  valor: string
  titulo: string
  detalle: string
  formas: string[]
  /** El importe en la moneda de ese medio. */
  importe: string
  equivalencia: string | null
}

/**
 * Traduce un medio de pago para el portal.
 *
 * Los títulos de `MEDIOS_DE_COBRO` (`lib/payments`) están en español porque
 * también los ve el staff. El checkout y la pantalla de pago por token los
 * reemplazan por los del diccionario: vivía dentro del checkout y la pantalla
 * de pago mostraba los medios en español aunque el resto estuviera traducido.
 * Un medio desconocido (una pasarela nueva sin traducir) se muestra con su
 * texto original antes que no mostrarse.
 */
export function medioTraducido(o: OpcionDePago, tx: Diccionario): MedioTraducido {
  const c = tx.checkout
  const traducidos: Record<string, { titulo: string; detalle: string; formas: readonly string[] }> = {
    stripe: { titulo: c.medioStripe, detalle: c.medioStripeDetalle, formas: o.medio.formas },
    mercadopago: {
      titulo: c.medioMercadoPago,
      detalle: c.medioMercadoPagoDetalle,
      formas: c.formasMercadoPago,
    },
    simulado: { titulo: c.medioSimulado, detalle: c.medioSimuladoDetalle, formas: [] },
  }
  const textosMedio = traducidos[o.valor] ?? o.medio
  return {
    valor: o.valor,
    titulo: textosMedio.titulo,
    detalle: textosMedio.detalle,
    formas: [...textosMedio.formas],
    importe: o.importe,
    equivalencia: o.equivalenciaPartes ? rellenar(c.alCambio, o.equivalenciaPartes) : null,
  }
}
