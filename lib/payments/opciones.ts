import 'server-only'

import { proveedoresHabilitados, nombreClave } from '@/lib/payments'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import {
  MEDIOS_DE_COBRO,
  MONEDA_BASE,
  calcularCobro,
  type MedioDeCobro,
  type MonedaCobro,
} from '@/lib/domain/cobro'
import { formatearLocal } from '@/lib/domain/divisas'
import { formatearUSD } from '@/lib/domain/moneda'

/*
  Qué medios de pago se le ofrecen al huésped, con el importe exacto en la
  moneda de cada uno.

  Vivía dentro de la pantalla de pago (`/reservar/pagar/<token>`). Se mudó acá
  cuando el checkout empezó a ofrecer pagar la seña en el mismo paso: las dos
  pantallas tienen que mostrar exactamente los mismos medios y los mismos
  importes, y una regla de plata copiada en dos lugares es una regla que un
  día diverge (ver `saldarSiCorresponde` en CLAUDE.md).
*/

export interface OpcionDePago {
  /**
   * Lo que viaja en el formulario como `medio`: el nombre con el que se elige
   * la pasarela en `PAGO_PROVIDER`. Coincide con `medio.id` salvo en el
   * simulador, que se guarda como `tarjeta` pero se elige como `simulado`.
   */
  valor: string
  medio: MedioDeCobro
  /** Lo que se va a debitar, en la moneda del medio. */
  importe: string
  /** Sólo cuando la moneda no es la base: cómo se llegó a ese número. */
  equivalencia: string | null
  /**
   * Las dos piezas de `equivalencia` por separado, ya formateadas, para que
   * una pantalla en otro idioma arme su propia frase con los mismos números.
   */
  equivalenciaPartes: { usd: string; tasa: string } | null
}

/**
 * Los medios que de verdad se pueden ofrecer ahora mismo.
 *
 * Es la intersección de tres cosas, y las tres pueden faltar:
 *  1. el catálogo (`MEDIOS_DE_COBRO`),
 *  2. lo que el hotel contrató (`PAGO_PROVIDER`),
 *  3. que haya **cotización vigente** si el medio cobra en otra moneda.
 *
 * El punto 3 es el que se olvida: sin cotización no se puede convertir, y
 * ofrecer el medio igual terminaría en un error después de que el huésped ya
 * eligió. Es mejor no mostrarlo.
 */
export async function opcionesDePago(montoUSD: number): Promise<OpcionDePago[]> {
  const habilitados = new Set(proveedoresHabilitados().map(nombreClave))
  const salida: OpcionDePago[] = []

  for (const medio of MEDIOS_DE_COBRO) {
    if (!habilitados.has(medio.id)) continue

    const cotizacion = await cotizacionDe(medio.moneda)
    const cobro = calcularCobro(montoUSD, medio.moneda, cotizacion)
    if (!cobro) continue

    salida.push({
      valor: medio.id,
      medio,
      importe:
        cobro.moneda === MONEDA_BASE
          ? formatearUSD(cobro.montoCobrado)
          : formatearLocal(cobro.montoCobrado, cobro.moneda),
      equivalencia:
        cobro.moneda === MONEDA_BASE
          ? null
          : `${formatearUSD(cobro.monto)} al cambio de ${formatearLocal(cobro.cotizacion, cobro.moneda)} por dólar`,
      equivalenciaPartes:
        cobro.moneda === MONEDA_BASE
          ? null
          : {
              usd: formatearUSD(cobro.monto),
              tasa: formatearLocal(cobro.cotizacion, cobro.moneda),
            },
    })
  }

  /*
    El simulador. No está en `MEDIOS_DE_COBRO` porque no es un medio de pago que
    se le ofrezca a nadie: es la herramienta con la que se recorre el circuito
    completo sin pasarela contratada. Se muestra con su nombre y su advertencia
    —nunca disfrazado de medio real— y sólo aparece si alguien lo habilitó a
    propósito en `PAGO_PROVIDER`.
  */
  if (habilitados.has('simulado')) {
    salida.push({
      valor: 'simulado',
      medio: {
        id: 'tarjeta',
        moneda: MONEDA_BASE,
        titulo: 'Pago simulado (demostración)',
        detalle: 'No mueve dinero. Sirve para probar el circuito completo de cobro.',
        formas: ['Aprobar', 'Rechazar', 'Dejar pendiente'],
      },
      importe: formatearUSD(montoUSD),
      equivalencia: null,
      equivalenciaPartes: null,
    })
  }

  return salida
}

/** La cotización vigente de una moneda, o `null` si es la base o no hay. */
async function cotizacionDe(moneda: MonedaCobro): Promise<number | null> {
  if (moneda === MONEDA_BASE) return null
  const vigente = await cotizacionVigente(moneda)
  // `venta` es la que se cobra: cuántas unidades cuesta comprar un dólar.
  return vigente?.venta ?? null
}
