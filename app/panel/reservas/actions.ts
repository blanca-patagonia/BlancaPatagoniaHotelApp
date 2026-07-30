'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { TarifaTipo } from '@/lib/domain/precios'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { diasEntre } from '@/lib/fechas'
import { puedeTransicionar, type EstadoReserva } from '@/lib/domain/reservas'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { puntosPorEstadia } from '@/lib/domain/fidelidad'

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
    .select('estado, total, huesped_id')
    .eq('id', id)
    .single()
  if (!reserva) redirect('/panel/reservas')

  if (!puedeTransicionar(reserva.estado as EstadoReserva, nuevo)) {
    redirect(`/panel/reservas/${id}?error=transicion`)
  }

  await supabase.from('reservas').update({ estado: nuevo }).eq('id', id)

  // Fidelidad: el check-out otorga puntos al huésped (una sola vez; 'checkout' es terminal).
  if (nuevo === 'checkout' && reserva.huesped_id) {
    const puntos = puntosPorEstadia(Number(reserva.total))
    if (puntos > 0) {
      const { data: h } = await supabase
        .from('huespedes')
        .select('puntos')
        .eq('id', reserva.huesped_id)
        .single()
      await supabase
        .from('huespedes')
        .update({ puntos: (h?.puntos ?? 0) + puntos })
        .eq('id', reserva.huesped_id)
    }
  }

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

export interface EstadoReservaGrupal {
  error?: string
}

/**
 * Alta de una reserva GRUPAL: crea varias reservas (una por unidad) que comparten
 * un `grupo_id`. Reutiliza el alta atómica por unidad (anti-overbooking) y permite
 * check-out escalonado y facturación consolidada por grupo.
 */
export async function crearReservaGrupal(
  _prev: EstadoReservaGrupal,
  formData: FormData,
): Promise<EstadoReservaGrupal> {
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const canal = String(formData.get('canal') ?? 'directo')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()

  if (!checkIn || !checkOut || checkOut <= checkIn) return { error: 'Revisá las fechas.' }
  if (!apellido) return { error: 'Ingresá el apellido del titular del grupo.' }

  const selecciones: { tipoUnidadId: string; cantidad: number }[] = []
  for (const [k, v] of formData.entries()) {
    if (k.startsWith('qty_')) {
      const cantidad = Math.max(0, Number(v) || 0)
      if (cantidad > 0) selecciones.push({ tipoUnidadId: k.slice(4), cantidad })
    }
  }
  if (selecciones.length === 0) return { error: 'Elegí al menos una unidad.' }

  const supabase = await crearClienteServidor()
  const tarifaTipo = CANAL_TARIFA[canal] ?? 'rack'

  let huespedId: string | null = null
  if (email) {
    const { data: existente } = await supabase.from('huespedes').select('id').eq('email', email).maybeSingle()
    huespedId = existente?.id ?? null
  }
  if (!huespedId) {
    const { data: nuevo, error: eHuesped } = await supabase
      .from('huespedes')
      .insert({ nombre: nombre || apellido, apellido, email: email || null })
      .select('id')
      .single()
    if (eHuesped || !nuevo) return { error: 'No se pudo registrar al titular.' }
    huespedId = nuevo.id
  }

  if (!huespedId) return { error: 'No se pudo registrar al titular.' }

  const grupoId = crypto.randomUUID()
  let creadas = 0
  let primerError: string | undefined
  for (const s of selecciones) {
    for (let i = 0; i < s.cantidad; i++) {
      const res = await crearReservaEnUnidadLibre(supabase, {
        tipoUnidadId: s.tipoUnidadId,
        checkIn,
        checkOut,
        huespedes: 2,
        huespedId,
        canal,
        tarifaTipo,
        estado: 'confirmada',
      })
      if (!res.ok) {
        primerError ??= res.error
        break // no quedan más unidades de este tipo
      }
      await supabase.from('reservas').update({ grupo_id: grupoId }).eq('id', res.reserva.id)
      creadas++
    }
  }

  if (creadas === 0) return { error: primerError ?? 'No se pudo crear el grupo.' }
  redirect(`/panel/reservas?grupo=${grupoId}`)
}

/**
 * Reprograma una reserva: cambia las fechas de su estadía, recotiza el total y
 * respeta el anti-overbooking (si el nuevo período pisa otra estadía activa de la
 * misma unidad, la restricción de exclusión lo rechaza).
 */
export async function reprogramarReserva(formData: FormData): Promise<void> {
  const id = String(formData.get('reserva_id') ?? '')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  if (!id) redirect('/panel/reservas')
  if (!checkIn || !checkOut || checkOut <= checkIn) redirect(`/panel/reservas/${id}?error=fechas`)

  const supabase = await crearClienteServidor()
  const { data: estadia } = await supabase
    .from('estadias')
    .select('id, tipo_unidad_id')
    .eq('reserva_id', id)
    .limit(1)
    .single()
  const { data: reserva } = await supabase.from('reservas').select('tarifa_tipo').eq('id', id).single()
  if (!estadia || !reserva) redirect(`/panel/reservas/${id}`)

  const tarifaTipo: TarifaTipo = reserva.tarifa_tipo === 'neto' ? 'neto' : 'rack'
  const cot = await cotizarEstadia({
    tipoUnidadId: estadia.tipo_unidad_id as string,
    checkIn,
    checkOut,
    tarifaTipo,
  })
  if (cot.faltanTarifas) redirect(`/panel/reservas/${id}?error=tarifa`)
  const noches = diasEntre(checkIn, checkOut)
  const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0

  const { error } = await supabase
    .from('estadias')
    .update({ periodo: `[${checkIn},${checkOut})`, precio_noche: precioNoche })
    .eq('id', estadia.id)
  if (error) {
    redirect(`/panel/reservas/${id}?error=${error.code === '23P01' ? 'overlap' : 'repro'}`)
  }
  await supabase.from('reservas').update({ total: cot.resumen.total }).eq('id', id)
  redirect(`/panel/reservas/${id}`)
}
