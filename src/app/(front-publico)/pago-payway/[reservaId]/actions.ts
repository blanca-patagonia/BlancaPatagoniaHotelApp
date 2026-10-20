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
import { NOTA_COBRADO_SIN_REGISTRAR } from '@/lib/payments/payway'
import { urlDelSitio } from '@/lib/env'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { registrarFalla } from '@/lib/acciones'

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

  if (!input.token || !input.externalId) {
    return { error: 'Faltan datos del cobro.' }
  }

  /*
    El importe y la reserva salen del cobro pendiente que creó el servidor, no
    de lo que manda el navegador: antes se cobraba y se registraba el `monto` y
    el `reservaId` del cliente, sin cruzarlos con ninguna fila de `pagos`.
  */
  const { data: cobro, error: eCobro } = await crearClienteAdmin()
    .from('pagos')
    .select('monto_cobrado, moneda, estado, reserva_id, nota')
    .eq('external_id', input.externalId)
    .maybeSingle()
  if (eCobro) {
    registrarFalla(eCobro, 'portal:payway:leer_cobro')
    return { error: 'No se pudo verificar el cobro. Probá de nuevo.' }
  }
  if (!cobro || cobro.estado !== 'pendiente' || cobro.reserva_id !== input.reservaId) {
    return { error: 'Ese cobro no está pendiente.' }
  }
  // Payway ya lo cobró y falló el registro: NO se cobra de nuevo.
  if (cobro.nota === NOTA_COBRADO_SIN_REGISTRAR) {
    return {
      error:
        'Este pago ya fue aprobado por Payway y el hotel lo está confirmando. No hace falta volver a pagar.',
    }
  }
  const monto = Number(cobro.monto_cobrado ?? 0)
  if (!(monto > 0) || cobro.moneda !== 'ARS') return { error: 'El cobro no tiene un importe válido.' }

  const r = await ejecutarPagoPayway({
    token: input.token,
    externalId: input.externalId,
    reservaId: cobro.reserva_id as string,
    monto,
    urlSitio: urlDelSitio(),
  })

  if ('error' in r) return { error: r.error }
  return { ok: true }
}
