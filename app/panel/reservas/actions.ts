'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { TarifaTipo } from '@/lib/domain/precios'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'
import { puedeTransicionar, type EstadoReserva } from '@/lib/domain/reservas'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'

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

  // Reusar el huésped por email o crearlo.
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

  if (!huespedId) return { error: 'No se pudo registrar al huésped.' }

  // Alta atómica: unidad libre + cotización + anti-overbooking (helper compartido).
  const res = await crearReservaEnUnidadLibre(supabase, {
    tipoUnidadId,
    checkIn,
    checkOut,
    huespedes: huespedesCant,
    huespedId,
    canal,
    tarifaTipo,
    estado: 'confirmada',
  })
  if (!res.ok) return { error: res.error }

  redirect(`/panel/reservas/${res.reserva.id}`)
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

/** Carga un consumo (producto × cantidad) a la cuenta de la reserva. */
export async function agregarConsumo(formData: FormData): Promise<void> {
  const reservaId = String(formData.get('reserva_id') ?? '')
  const productoId = String(formData.get('producto_id') ?? '')
  const cantidad = Math.max(1, Number(formData.get('cantidad') ?? 1) || 1)
  if (!reservaId || !productoId) redirect(`/panel/reservas/${reservaId}`)

  const supabase = await crearClienteServidor()
  const { data: producto } = await supabase
    .from('productos_servicios')
    .select('precio')
    .eq('id', productoId)
    .single()
  if (producto) {
    await supabase.from('consumos').insert({
      reserva_id: reservaId,
      producto_id: productoId,
      cantidad,
      precio_unitario: Number(producto.precio),
    })
  }
  redirect(`/panel/reservas/${reservaId}`)
}

/** Quita un consumo de la cuenta. */
export async function quitarConsumo(formData: FormData): Promise<void> {
  const reservaId = String(formData.get('reserva_id') ?? '')
  const consumoId = String(formData.get('consumo_id') ?? '')
  if (consumoId) {
    const supabase = await crearClienteServidor()
    await supabase.from('consumos').delete().eq('id', consumoId)
  }
  redirect(`/panel/reservas/${reservaId}`)
}

/** Emite la factura interna con la cuenta consolidada (alojamiento + consumos). */
export async function emitirFactura(formData: FormData): Promise<void> {
  const reservaId = String(formData.get('reserva_id') ?? '')
  if (!reservaId) redirect('/panel/reservas')

  const supabase = await crearClienteServidor()
  const { data: existente } = await supabase
    .from('facturas')
    .select('id')
    .eq('reserva_id', reservaId)
    .maybeSingle()

  if (!existente) {
    const { data: reserva } = await supabase
      .from('reservas')
      .select('total')
      .eq('id', reservaId)
      .single()
    const { data: consumosData } = await supabase
      .from('consumos')
      .select('cantidad, precio_unitario')
      .eq('reserva_id', reservaId)
    const consumos: Consumo[] = (consumosData ?? []).map((c) => ({
      cantidad: c.cantidad as number,
      precioUnitario: Number(c.precio_unitario),
    }))
    const cuenta = cuentaConsolidada(Number(reserva?.total ?? 0), consumos)
    await supabase.from('facturas').insert({ reserva_id: reservaId, total: cuenta.total })
  }

  redirect(`/panel/reservas/${reservaId}/factura`)
}
