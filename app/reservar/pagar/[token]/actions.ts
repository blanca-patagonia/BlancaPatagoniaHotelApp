'use server'

/**
 * Pago del huésped desde el portal público.
 *
 * Acá no hay sesión: la credencial es el **token** de la reserva, el mismo que
 * viaja en el enlace de confirmación. Por eso se trabaja con `service_role` y
 * por eso todo lo que se hace se resuelve a partir del token y nunca de un id
 * que venga en el formulario: si el `reserva_id` viniera del navegador,
 * cualquiera podría generar un link de pago sobre la reserva de otro —y, peor,
 * leer su saldo en la pantalla de resultado—.
 */

import { redirect } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { iniciarCobro, falloElCobro } from '@/lib/payments/servicio'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { motivoNoSeCobra } from '@/lib/domain/cobro'
import { urlDelSitio } from '@/lib/env'
import type { EstadoReserva } from '@/lib/domain/reservas'

/**
 * Genera el link de pago y manda al huésped a la pasarela.
 *
 * No devuelve estado porque siempre termina en un `redirect`: o a la pasarela, o
 * de vuelta a la pantalla de pago con el motivo del fallo.
 */
export async function pagarDesdeElPortal(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  const medio = String(formData.get('medio') ?? '')
  const tipoPedido = String(formData.get('tipo') ?? 'senia')

  if (!token) redirect('/reservar')

  const admin = crearClienteAdmin()

  const { data: reserva, error } = await admin
    .from('reservas')
    .select('id, estado, codigo, huesped:huespedes!reservas_huesped_id_fkey(email)')
    .eq('token', token)
    .maybeSingle()

  if (error || !reserva) redirect(`/reservar/pagar/${token}?error=no_encontrada`)

  const cobro = await estadoDeCobro(admin, reserva.id)
  if (!cobro) redirect(`/reservar/pagar/${token}?error=sin_datos`)

  // La seña sólo tiene sentido mientras no se haya pagado ninguna; después,
  // lo que queda es saldo. El tipo que llega del formulario se corrige acá en
  // vez de confiarse: define contra qué se imputa la plata.
  const tipo = tipoPedido === 'senia' && !cobro.tieneSenia ? 'senia' : 'saldo'
  const monto = tipo === 'senia' ? Math.min(cobro.senia, cobro.saldo) : cobro.saldo

  const impedimento = motivoNoSeCobra(reserva.estado as EstadoReserva, cobro.saldo)
  if (impedimento) redirect(`/reservar/pagar/${token}?error=no_cobrable`)

  const base = urlDelSitio().replace(/\/$/, '')
  // Las tres vuelven a la confirmación a propósito: esa pantalla lee el estado
  // real de la base. La URL de retorno de una pasarela **no es una prueba de
  // pago** —se puede abrir a mano sin haber pagado nada— así que decidir con
  // ella qué mostrar sería mentirle al huésped. Quien confirma es el webhook.
  const volver = `${base}/reservar/confirmacion/${token}`

  const resultado = await iniciarCobro(admin, {
    reservaId: reserva.id,
    tipo,
    montoUSD: monto,
    proveedor: medio,
    descripcion: `Hotel Blanca Patagonia · reserva ${reserva.codigo} · ${tipo === 'senia' ? 'seña' : 'saldo'}`,
    emailComprador: extraerEmail(reserva.huesped),
    urls: { exito: volver, error: volver, pendiente: volver },
  })

  if (falloElCobro(resultado)) {
    console.error(`[pago portal] ${reserva.codigo}: ${resultado.error}`)
    redirect(`/reservar/pagar/${token}?error=pasarela`)
  }

  redirect(resultado.url)
}

/**
 * El email del huésped, venga como objeto o como array.
 *
 * PostgREST devuelve un embed to-one como objeto, pero el tipo generado lo
 * declara como array cuando no puede probar la cardinalidad. Se contemplan los
 * dos casos para no romper según cómo resuelva el tipo.
 */
function extraerEmail(huesped: unknown): string | undefined {
  const h = Array.isArray(huesped) ? huesped[0] : huesped
  const email = (h as { email?: string } | null)?.email
  return email ?? undefined
}
