'use server'

/**
 * Ejecuta el pago contra Payway con el token que ya generó el navegador.
 *
 * Ver ADR 0038 y el docblock de `lib/payments/payway.ts`: acá es donde se usa
 * `PAYWAY_PRIVATE_KEY`, por eso esto es una Server Action y no algo que corra
 * en el cliente. No escribe en `pagos` directamente — delega en
 * `ejecutarPagoPayway`, que arma y firma el mismo evento que procesaría un
 * webhook real, para no abrir un segundo camino de escritura de dinero.
 */

import { permitirIntento } from '@/lib/limites'
import { mensajeLimite } from '@/lib/domain/limites'
import { proveedoresHabilitados, nombreClave, ejecutarPagoPayway } from '@/lib/payments'
import { urlDelSitio } from '@/lib/env'

export interface ResultadoFinalizarPago {
  ok?: true
  error?: string
}

export async function finalizarPagoPayway(input: {
  token: string
  externalId: string
  reservaId: string
  monto: number
}): Promise<ResultadoFinalizarPago> {
  const habilitado = proveedoresHabilitados().some((p) => nombreClave(p) === 'payway')
  if (!habilitado) return { error: 'Payway no está habilitado.' }

  if (!(await permitirIntento('payway_ejecutar_pago'))) {
    return { error: mensajeLimite('payway_ejecutar_pago') }
  }

  if (!input.token || !input.externalId || !input.reservaId || !(input.monto > 0)) {
    return { error: 'Faltan datos del cobro.' }
  }

  const r = await ejecutarPagoPayway({
    token: input.token,
    externalId: input.externalId,
    reservaId: input.reservaId,
    monto: input.monto,
    urlSitio: urlDelSitio(),
  })

  if ('error' in r) return { error: r.error }
  return { ok: true }
}
