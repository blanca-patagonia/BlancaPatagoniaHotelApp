'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { unidadesDisponibles } from '@/lib/availability/disponibilidad'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { diasEntre } from '@/lib/fechas'
import type { TarifaTipo } from '@/lib/domain/precios'
import { puedeTransicionar, type EstadoReserva } from '@/lib/domain/reservas'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'

export interface EstadoNuevaReserva {
  error?: string
}

const CANAL_TARIFA: Record<string, TarifaTipo> = {
  directo: 'rack',
  web: 'rack',
  booking: 'neto',
  expedia: 'neto',
}

export async function crearReservaAction(
  _prev: EstadoNuevaReserva,
  formData: FormData,
): Promise<EstadoNuevaReserva> {
  const tipoUnidadId = String(formData.get('tipo_unidad_id') ?? '')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const huespedesCant = Math.max(1, Number(formData.get('huespedes') ?? 1) || 1)
  const canal = String(formData.get('canal') ?? 'directo')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const docNumero = String(formData.get('doc_numero') ?? '').trim()

  if (!tipoUnidadId || !checkIn || !checkOut) return { error: 'Elegí fechas y un tipo de unidad.' }
  if (checkOut <= checkIn) return { error: 'El check-out debe ser posterior al check-in.' }
  if (!apellido) return { error: 'Ingresá al menos el apellido del huésped.' }

  const supabase = await crearClienteServidor()
  const tarifaTipo = CANAL_TARIFA[canal] ?? 'rack'

  // 1) Buscar una unidad libre del tipo elegido.
  const libres = await unidadesDisponibles(checkIn, checkOut)
  const unidad = libres.find((u) => u.tipo_unidad_id === tipoUnidadId)
  if (!unidad) return { error: 'No quedan unidades disponibles de ese tipo para esas fechas.' }

  // 2) Cotizar según el canal.
  const cot = await cotizarEstadia({ tipoUnidadId, checkIn, checkOut, tarifaTipo })
  if (cot.faltanTarifas) return { error: 'No hay tarifa cargada para todas esas fechas.' }
  const noches = diasEntre(checkIn, checkOut)
  const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0

  // 3) Reusar el huésped por email o crearlo.
  let huespedId: string | null = null
  if (email) {
    const { data: existente } = await supabase
      .from('huespedes')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    huespedId = existente?.id ?? null
  }
  if (!huespedId) {
    const { data: nuevo, error: eHuesped } = await supabase
      .from('huespedes')
      .insert({ nombre: nombre || apellido, apellido, email: email || null, doc_numero: docNumero })
      .select('id')
      .single()
    if (eHuesped || !nuevo) return { error: 'No se pudo registrar al huésped.' }
    huespedId = nuevo.id
  }

  // 4) Alta atómica (la exclusión anti-overbooking protege la operación).
  const { data: reserva, error } = await supabase.rpc('crear_reserva', {
    p_huesped_id: huespedId,
    p_unidad_id: unidad.id,
    p_tipo_unidad_id: tipoUnidadId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_huespedes: huespedesCant,
    p_precio_noche: precioNoche,
    p_total: cot.resumen.total,
    p_canal: canal,
    p_tarifa_tipo: tarifaTipo,
    p_estado: 'confirmada',
  })

  if (error) {
    if (error.code === '23P01') {
      return { error: 'La unidad se ocupó recién: elegí otras fechas o tipo.' }
    }
    return { error: `No se pudo crear la reserva: ${error.message}` }
  }

  redirect(`/panel/reservas/${(reserva as { id: string }).id}`)
}

/**
 * Cambia el estado de una reserva validando la transición con la máquina de
 * estados. El trigger de la base sincroniza las estadías (libera/ocupa inventario).
 */
export async function cambiarEstadoReserva(formData: FormData): Promise<void> {
  const id = String(formData.get('reserva_id') ?? '')
  const nuevo = String(formData.get('nuevo_estado') ?? '') as EstadoReserva
  if (!id || !nuevo) redirect('/panel/reservas')

  const supabase = await crearClienteServidor()
  const { data: reserva } = await supabase
    .from('reservas')
    .select('estado')
    .eq('id', id)
    .single()
  if (!reserva) redirect('/panel/reservas')

  if (!puedeTransicionar(reserva.estado as EstadoReserva, nuevo)) {
    redirect(`/panel/reservas/${id}?error=transicion`)
  }

  await supabase.from('reservas').update({ estado: nuevo }).eq('id', id)
  redirect(`/panel/reservas/${id}`)
}

/**
 * Registra un pago (seña / saldo / reembolso) sobre la reserva. Si con este pago
 * la reserva queda saldada, intenta la transición a `pagada`.
 */
export async function registrarPago(formData: FormData): Promise<void> {
  const reservaId = String(formData.get('reserva_id') ?? '')
  const medio = String(formData.get('medio') ?? 'efectivo')
  const tipo = String(formData.get('tipo') ?? 'saldo')
  const monto = Number(formData.get('monto') ?? 0)
  if (!reservaId) redirect('/panel/reservas')
  if (!(monto > 0)) redirect(`/panel/reservas/${reservaId}?error=monto`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('pagos')
    .insert({ reserva_id: reservaId, medio, tipo, monto, estado: 'aprobado' })
  if (error) redirect(`/panel/reservas/${reservaId}?error=pago`)

  // ¿Quedó saldada? → intentar pasar a 'pagada'.
  const { data: reserva } = await supabase
    .from('reservas')
    .select('estado, total')
    .eq('id', reservaId)
    .single()
  if (reserva && reserva.estado !== 'pagada') {
    const { data: pagos } = await supabase
      .from('pagos')
      .select('tipo, monto, estado')
      .eq('reserva_id', reservaId)
    const resumen = resumenPagos(Number(reserva.total), (pagos ?? []) as Pago[])
    if (resumen.saldada && puedeTransicionar(reserva.estado as EstadoReserva, 'pagada')) {
      await supabase.from('reservas').update({ estado: 'pagada' }).eq('id', reservaId)
    }
  }

  redirect(`/panel/reservas/${reservaId}`)
}
