import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { registrarFalla } from '@/lib/acciones'
import { ETIQUETAS_MEDIO, type MedioPago } from '@/lib/domain/pagos'
import {
  avisarPagoInterno,
  avisarPagoRechazado,
  avisarPagoRecibido,
  avisarReservaConfirmada,
  type DestinoHuesped,
} from './eventos'

/**
 * Los avisos que dispara un cobro, en un solo lugar.
 *
 * ── Por qué acá y no en cada llamador ───────────────────────────────────────
 *
 * Un cobro se registra desde dos lados —el webhook de la pasarela y el mostrador
 * (`registrarPago`)— y los dos tienen que avisar lo mismo. Es exactamente la
 * situación que ya se dio con `saldarSiCorresponde`: la misma secuencia escrita
 * dos veces, que **divergió**, y el síntoma fue una reserva marcada «pagada»
 * debiendo el frigobar. Una regla de plata duplicada se vuelve a separar.
 *
 * ── Nunca corta el cobro ────────────────────────────────────────────────────
 *
 * Devuelve `void` y no lanza. Que no se pueda anotar un aviso no justifica
 * responderle 500 a la pasarela: el reintento volvería a cobrar el mismo pago
 * para arreglar un correo. Lo que falla queda en `/panel/errores`.
 */

/** Lo que hace falta saber de la reserva para poder avisar de un cobro. */
interface Contexto {
  destino: DestinoHuesped
  checkIn: string
  checkOut: string
  huespedCompleto: string
  saldo: number
}

/**
 * Junta reserva, huésped, estadía y saldo.
 *
 * `null` si falta algo: sin la reserva o sin la estadía no hay aviso posible, y
 * es mejor no mandar nada que mandar un correo con fechas en blanco.
 */
async function contextoDelCobro(
  client: SupabaseClient,
  reservaId: string,
): Promise<Contexto | null> {
  const { data: reserva, error } = await client
    .from('reservas')
    .select(
      `id, codigo, total, huesped_id,
       huesped:huespedes!reservas_huesped_id_fkey(nombre, apellido, email, telefono),
       estadia:estadias(check_in, check_out)`,
    )
    .eq('id', reservaId)
    .maybeSingle()

  if (error) {
    registrarFalla(error, `leer la reserva ${reservaId} para avisar del cobro`)
    return null
  }
  if (!reserva) return null

  const r = reserva as unknown as {
    id: string
    codigo: string
    total: number
    huesped_id: string | null
    huesped: { nombre: string; apellido: string; email: string | null; telefono: string | null } | null
    // ⚠️ PostgREST tipa el embed como arreglo aunque la relación sea a-uno.
    estadia: { check_in: string; check_out: string }[] | null
  }

  const estadia = r.estadia?.[0]
  if (!estadia) return null

  /*
    El saldo se calcula con la cuenta CONSOLIDADA —alojamiento más consumos—, no
    con `reservas.total`. Decirle «saldo 0» a quien consumió del frigobar es el
    mismo error que costó que una reserva quedara «pagada» debiendo esa parte.
  */
  const [{ data: pagos }, { data: consumos }] = await Promise.all([
    client.from('pagos').select('tipo, monto, estado').eq('reserva_id', reservaId),
    client.from('consumos').select('cantidad, precio_unitario').eq('reserva_id', reservaId),
  ])

  const cuenta = cuentaConsolidada(
    Number(r.total),
    (consumos ?? []).map((c) => ({
      cantidad: (c as { cantidad: number }).cantidad,
      precioUnitario: Number((c as { precio_unitario: number }).precio_unitario),
    })) as Consumo[],
  )
  const resumen = resumenPagos(cuenta.total, (pagos ?? []) as Pago[])

  const nombre = r.huesped?.nombre ?? ''
  const apellido = r.huesped?.apellido ?? ''

  return {
    destino: {
      reservaId: r.id,
      huespedId: r.huesped_id,
      email: r.huesped?.email ?? null,
      telefono: r.huesped?.telefono ?? null,
      // El nombre de pila para saludar; el completo, para la cartelera interna.
      nombre: nombre || apellido,
      codigo: r.codigo,
    },
    checkIn: estadia.check_in,
    checkOut: estadia.check_out,
    huespedCompleto: `${nombre} ${apellido}`.trim() || 'Sin nombre',
    saldo: resumen.saldo,
  }
}

/**
 * Un pago se acreditó: avisarle al huésped y al mostrador.
 *
 * `confirmada` viene de `saldarSiCorresponde` y dice si **este** cobro fue el que
 * pasó la reserva a firme. Es lo que distingue «recibimos tu pago» de «tu reserva
 * está confirmada», y por eso los dos avisos existen separados: uno sale al alta
 * aclarando que falta la seña, el otro cuando la seña llegó.
 */
export async function avisarCobroAprobado(
  client: SupabaseClient,
  d: {
    reservaId: string
    pagoId: string
    importe: number
    medio: string
    confirmada: boolean
  },
): Promise<void> {
  const ctx = await contextoDelCobro(client, d.reservaId)
  if (!ctx) return

  await avisarPagoRecibido(client, ctx.destino, {
    pagoId: d.pagoId,
    importe: d.importe,
    saldo: ctx.saldo,
  })

  if (d.confirmada) {
    await avisarReservaConfirmada(client, ctx.destino, {
      checkIn: ctx.checkIn,
      checkOut: ctx.checkOut,
      saldo: ctx.saldo,
    })
  }

  // El mostrador se entera del cobro por la cartelera, no abriendo la reserva.
  await avisarPagoInterno(client, {
    pagoId: d.pagoId,
    reservaId: d.reservaId,
    codigo: ctx.destino.codigo,
    huesped: ctx.huespedCompleto,
    importe: d.importe,
    medio: ETIQUETAS_MEDIO[d.medio as MedioPago] ?? d.medio,
    saldo: ctx.saldo,
  })
}

/**
 * La pasarela rechazó el pago.
 *
 * ⚠️ No hay aviso interno para esto, y es deliberado: un rechazo es rutina —la
 * tarjeta se cae por fondos y el huésped pone otra— y llenar la cartelera de
 * rechazos haría que nadie la mirara. El huésped sí necesita saberlo, porque es
 * quien puede reintentar.
 */
export async function avisarCobroRechazado(
  client: SupabaseClient,
  d: { reservaId: string; pagoId: string; importe: number; enlace: string },
): Promise<void> {
  const ctx = await contextoDelCobro(client, d.reservaId)
  if (!ctx) return

  await avisarPagoRechazado(client, ctx.destino, {
    pagoId: d.pagoId,
    importe: d.importe,
    enlace: d.enlace,
  })
}
