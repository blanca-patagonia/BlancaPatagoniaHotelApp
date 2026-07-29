'use server'

import { redirect } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { enviarEmailConfirmacion } from '@/lib/email/confirmacion'
import { diasEntre } from '@/lib/fechas'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'

export interface EstadoReservaPublica {
  error?: string
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NOCHES_PUBLICO = 30

/**
 * Crea una reserva desde el portal público. Corre con `service_role` (el visitante
 * es anónimo): asigna una unidad libre, cotiza y crea la reserva en estado
 * `pendiente` (bloquea el inventario por la restricción de exclusión). La reserva
 * se confirma con el pago de la seña.
 */
export async function crearReservaPublica(
  _prev: EstadoReservaPublica,
  formData: FormData,
): Promise<EstadoReservaPublica> {
  const tipoUnidadId = String(formData.get('tipo') ?? '')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const huespedesCant = Math.max(1, Number(formData.get('huespedes') ?? 1) || 1)
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim()

  if (!tipoUnidadId || !checkIn || !checkOut || checkOut <= checkIn) {
    return { error: 'Datos de la reserva incompletos.' }
  }
  if (!apellido || !email) return { error: 'Ingresá tu apellido y tu email.' }
  if (!RE_EMAIL.test(email)) return { error: 'Ingresá un email válido.' }
  if (diasEntre(checkIn, checkOut) > MAX_NOCHES_PUBLICO) {
    return { error: `La estadía no puede superar las ${MAX_NOCHES_PUBLICO} noches.` }
  }

  const admin = crearClienteAdmin()

  // Registrar al huésped.
  const { data: huesped, error: eHuesped } = await admin
    .from('huespedes')
    .insert({ nombre: nombre || apellido, apellido, email, telefono })
    .select('id')
    .single()
  if (eHuesped || !huesped) return { error: 'No se pudieron registrar tus datos.' }

  // Alta atómica (service_role): unidad libre + cotización + anti-overbooking.
  const res = await crearReservaEnUnidadLibre(admin, {
    tipoUnidadId,
    checkIn,
    checkOut,
    huespedes: huespedesCant,
    huespedId: huesped.id,
    canal: 'web',
    tarifaTipo: 'rack',
    estado: 'pendiente',
  })
  if (!res.ok) return { error: res.error }
  const nueva = res.reserva
  // La URL pública usa el token opaco (no el código, que es enumerable).
  const { data: full } = await admin
    .from('reservas')
    .select('token')
    .eq('id', nueva.id)
    .single()
  const token = (full as { token: string } | null)?.token ?? nueva.id

  await enviarEmailConfirmacion({
    email,
    nombre: apellido,
    codigo: nueva.codigo,
    checkIn,
    checkOut,
    total: Number(nueva.total),
  })

  redirect(`/reservar/confirmacion/${token}`)
}
