import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { iniciarCobro, falloElCobro } from '@/lib/payments/servicio'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { motivoNoSeCobra } from '@/lib/domain/cobro'
import { urlDelSitio } from '@/lib/env'
import { registrarError } from '@/lib/registro'
import type { EstadoReserva } from '@/lib/domain/reservas'

/**
 * Abre el cobro de una reserva desde el portal público y devuelve la URL de la
 * pasarela.
 *
 * Lo usan dos caminos que tienen que cobrar EXACTAMENTE lo mismo:
 *
 * · el checkout, que ofrece pagar la seña en el mismo paso en que se reserva;
 * · la pantalla de pago por token (`/reservar/pagar/<token>`), para quien
 *   reservó y paga después, o vuelve a intentar con otra tarjeta.
 *
 * Por eso el importe NO llega de afuera: se calcula acá con `estadoDeCobro`, a
 * partir de lo que dice la base. Un monto que viniera del formulario se podría
 * editar en el navegador.
 *
 * ⚠️ La URL de retorno es la confirmación, y es a propósito: esa pantalla lee
 * el estado real de la base. Volver de la pasarela **no prueba que se pagó**
 * —la URL se puede abrir a mano—; quien confirma es el webhook (ADR 0027).
 */
export type ResultadoCobroPortal =
  | { ok: true; url: string }
  | { ok: false; motivo: 'sin_datos' | 'no_cobrable' | 'pasarela' }

export async function abrirCobroDelPortal(
  admin: SupabaseClient,
  p: {
    reservaId: string
    codigo: string
    estado: EstadoReserva
    token: string
    medio: string
    /** Lo que pidió el huésped. Se corrige si ya no corresponde (ver abajo). */
    tipoPedido: 'senia' | 'saldo'
    email?: string
  },
): Promise<ResultadoCobroPortal> {
  const cobro = await estadoDeCobro(admin, p.reservaId)
  if (!cobro) return { ok: false, motivo: 'sin_datos' }

  // La seña sólo tiene sentido mientras no se haya pagado ninguna; después,
  // lo que queda es saldo. Define contra qué se imputa la plata.
  const tipo = p.tipoPedido === 'senia' && !cobro.tieneSenia ? 'senia' : 'saldo'
  const monto = tipo === 'senia' ? Math.min(cobro.senia, cobro.saldo) : cobro.saldo

  if (motivoNoSeCobra(p.estado, cobro.saldo)) return { ok: false, motivo: 'no_cobrable' }

  const volver = `${urlDelSitio().replace(/\/$/, '')}/reservar/confirmacion/${p.token}`
  const resultado = await iniciarCobro(admin, {
    reservaId: p.reservaId,
    tipo,
    montoUSD: monto,
    proveedor: p.medio,
    descripcion: `Hotel Blanca Patagonia · reserva ${p.codigo} · ${tipo === 'senia' ? 'seña' : 'saldo'}`,
    emailComprador: p.email,
    urls: { exito: volver, error: volver, pendiente: volver },
  })

  if (falloElCobro(resultado)) {
    // Una venta que no se concreta. Va a `errores`: el huésped ve un mensaje
    // genérico y se va, y sin esto el hotel no se entera de que pasó.
    await registrarError('cobro_link_portal', { reserva: p.codigo, detalle: resultado.error })
    return { ok: false, motivo: 'pasarela' }
  }
  return { ok: true, url: resultado.url }
}
