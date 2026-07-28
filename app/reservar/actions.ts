'use server'

import { redirect } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { enviarEmailConfirmacion } from '@/lib/email/confirmacion'
import { diasEntre } from '@/lib/fechas'

export interface EstadoReservaPublica {
  error?: string
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NOCHES_PUBLICO = 30

interface UnidadLibre {
  id: string
  tipo_unidad_id: string
}

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

  // Unidad libre (service_role → disponibilidad real, sin RLS).
  const { data: libresData } = await admin.rpc('unidades_disponibles', {
    desde: checkIn,
    hasta: checkOut,
    p_categoria: null,
  })
  const unidad = ((libresData ?? []) as UnidadLibre[]).find(
    (u) => u.tipo_unidad_id === tipoUnidadId,
  )
  if (!unidad) return { error: 'Esa unidad ya no está disponible para esas fechas.' }

  const cot = await cotizarEstadia({ tipoUnidadId, checkIn, checkOut, tarifaTipo: 'rack' })
  if (cot.faltanTarifas) return { error: 'No hay tarifa disponible para esas fechas.' }
  const noches = diasEntre(checkIn, checkOut)
  const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0

  const { data: huesped, error: eHuesped } = await admin
    .from('huespedes')
    .insert({ nombre: nombre || apellido, apellido, email, telefono })
    .select('id')
    .single()
  if (eHuesped || !huesped) return { error: 'No se pudieron registrar tus datos.' }

  const { data: reserva, error } = await admin.rpc('crear_reserva', {
    p_huesped_id: huesped.id,
    p_unidad_id: unidad.id,
    p_tipo_unidad_id: tipoUnidadId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_huespedes: huespedesCant,
    p_precio_noche: precioNoche,
    p_total: cot.resumen.total,
    p_canal: 'web',
    p_tarifa_tipo: 'rack',
    p_estado: 'pendiente',
  })
  if (error) {
    if (error.code === '23P01') {
      return { error: 'La unidad se ocupó recién. Probá con otras fechas.' }
    }
    return { error: 'No se pudo crear la reserva. Intentá nuevamente.' }
  }

  const codigo = (reserva as { codigo: string }).codigo
  await enviarEmailConfirmacion({
    email,
    nombre: apellido,
    codigo,
    checkIn,
    checkOut,
    total: cot.resumen.total,
  })

  redirect(`/reservar/confirmacion/${codigo}`)
}
