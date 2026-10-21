import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import { MENSAJES_NO_CARGABLE, motivoNoCargable, type MotivoNoCargable } from '@/lib/domain/servicio'

export type ClaveFallaConsumo = MotivoNoCargable | 'consumo' | 'consumo_verificar'

export type ResultadoCargo = { ok: true } | { ok: false; clave: ClaveFallaConsumo; mensaje: string }

const MENSAJES: Record<ClaveFallaConsumo, string> = {
  ...MENSAJES_NO_CARGABLE,
  consumo: 'No se pudo cargar el consumo. No se cobró ni se descontó del stock.',
  consumo_verificar:
    'No se pudo verificar si esta reserva admite un cargo nuevo. No se cargó nada — probá de nuevo.',
}

function falla(clave: ClaveFallaConsumo): ResultadoCargo {
  return { ok: false, clave, mensaje: MENSAJES[clave] }
}

/**
 * Carga un consumo a la cuenta de una reserva, con el precio del catálogo.
 *
 * Es la regla de la ficha de reserva (`agregarConsumo`) sacada a una función que
 * DEVUELVE el resultado en vez de redirigir, para que la use también el
 * asistente de IA (ADR 0041). Con el `redirect` adentro, confirmar un consumo
 * desde el chat sacaba a la persona de la pantalla y perdía la conversación,
 * tanto si salía bien como si salía mal.
 *
 * ¿Se le puede cargar algo a esta reserva? (P3 del relevamiento del 15/08/2026)
 *
 * La cuenta NO se cierra en el check-out sino en la **factura**. Es lo que
 * permite los dos casos reales de todos los días: el huésped que llega a las 9
 * y desayuna antes del check-in de las 15, y el que hace el check-out a las 10
 * habiendo desayunado esa mañana. Lo que sí corta es el comprobante emitido: un
 * cargo posterior no entraría en él, y `facturas` es inmutable (migración 0034).
 *
 * Fail-closed: si no se pudo leer el estado o la factura, NO se asume «todavía
 * no tiene factura»: un consumo posterior a la factura se pierde para siempre.
 */
export async function cargarConsumo(
  supabase: SupabaseClient,
  reservaId: string,
  productoId: string,
  cantidad: number,
): Promise<ResultadoCargo> {
  const [
    { data: reserva, error: eEstado },
    { data: factura, error: eFactura },
  ] = await Promise.all([
    supabase.from('reservas').select('estado').eq('id', reservaId).maybeSingle(),
    supabase.from('facturas').select('id').eq('reserva_id', reservaId).maybeSingle(),
  ])
  if (eEstado || eFactura) {
    registrarFalla(eEstado ?? eFactura, 'consumos:verificar_cuenta')
    return falla('consumo_verificar')
  }

  const motivo = motivoNoCargable(String(reserva?.estado ?? ''), Boolean(factura))
  if (motivo) return falla(motivo)

  const { data: producto, error: eProducto } = await supabase
    .from('productos_servicios')
    .select('precio')
    .eq('id', productoId)
    .single()
  if (eProducto || !producto) {
    registrarFalla(eProducto ?? { message: 'producto inexistente' }, 'consumos:leer_producto')
    return falla('consumo_verificar')
  }

  // El trigger de la base descuenta stock al insertar: si esto falla y no se
  // avisa, el consumo no se cobra y el stock queda mostrando otra cosa.
  const { error } = await supabase.from('consumos').insert({
    reserva_id: reservaId,
    producto_id: productoId,
    cantidad,
    precio_unitario: Number(producto.precio),
  })
  if (error) {
    registrarFalla(error, 'consumos:insertar')
    return falla('consumo')
  }
  return { ok: true }
}
