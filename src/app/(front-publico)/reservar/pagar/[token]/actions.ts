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
import { abrirCobroDelPortal } from '@/lib/payments/portal'
import { permitirIntento } from '@/lib/limites'
import { idiomaValido } from '@/lib/i18n'
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
  const idioma = idiomaValido(String(formData.get('idioma') ?? '') || undefined)
  /** Vuelta a la pantalla de pago con el motivo, en el idioma en que estaba. */
  const conError = (motivo: string) =>
    `/reservar/pagar/${token}?error=${motivo}${idioma === 'es' ? '' : `&idioma=${idioma}`}`

  if (!token) redirect('/reservar')
  if (!(await permitirIntento('pago_portal'))) redirect(conError('limite'))

  const admin = crearClienteAdmin()

  const { data: reserva, error } = await admin
    .from('reservas')
    .select('id, estado, codigo, huesped:huespedes!reservas_huesped_id_fkey(email)')
    .eq('token', token)
    .maybeSingle()

  if (error || !reserva) redirect(conError('no_encontrada'))

  const resultado = await abrirCobroDelPortal(admin, {
    reservaId: reserva.id,
    codigo: reserva.codigo,
    estado: reserva.estado as EstadoReserva,
    token,
    medio,
    tipoPedido: tipoPedido === 'saldo' ? 'saldo' : 'senia',
    email: extraerEmail(reserva.huesped),
    idioma,
  })
  if (!resultado.ok) redirect(conError(resultado.motivo))

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
