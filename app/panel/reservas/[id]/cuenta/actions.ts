'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'
import { esFolio } from '@/lib/domain/folios'
import { esMonedaExtranjera, convertirAUSD } from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'

/**
 * Acciones de la cuenta del huésped: split entre folios y cargo manual.
 */

function destino(reservaId: string): string {
  return `/panel/reservas/${reservaId}/cuenta`
}

async function exigirAcceso() {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'reservas')) redirect('/panel')
  return sesion
}

/**
 * Mueve un consumo de folio.
 *
 * Es el split, en su forma más simple: una línea a la vez. No cambia importes, sólo
 * a quién se le cobra, así que el total general no se mueve —es la invariante que
 * `foliosCierran` protege—.
 */
export async function moverConsumoDeFolio(formData: FormData): Promise<void> {
  await exigirAcceso()

  const reservaId = String(formData.get('reserva_id') ?? '')
  const consumoId = String(formData.get('consumo_id') ?? '')
  const folio = String(formData.get('folio') ?? '')

  if (!reservaId || !consumoId) redirect('/panel/reservas')
  if (!esFolio(folio)) redirect(`${destino(reservaId)}?error=folio`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('consumos')
    .update({ folio })
    // Se acota por reserva además del id: sin esto, un id de otra reserva movería
    // un cargo ajeno. El RLS deja pasar la escritura (recepción puede tocar
    // cualquier consumo), así que la guarda tiene que estar acá.
    .eq('id', consumoId)
    .eq('reserva_id', reservaId)

  cortarSiFalla(error, destino(reservaId), 'mover')
  revalidatePath(destino(reservaId))
  redirect(`${destino(reservaId)}?ok=movido`)
}

/**
 * Mueve el cargo de alojamiento de folio.
 *
 * El alojamiento no es una fila de `consumos` —sale de `reservas.total`— así que
 * moverlo cambia `reservas.folio_alojamiento`. Es el caso típico del split: la
 * empresa paga la habitación y el huésped sus consumos.
 */
export async function moverAlojamientoDeFolio(formData: FormData): Promise<void> {
  await exigirAcceso()

  const reservaId = String(formData.get('reserva_id') ?? '')
  const folio = String(formData.get('folio') ?? '')

  if (!reservaId) redirect('/panel/reservas')
  if (!esFolio(folio)) redirect(`${destino(reservaId)}?error=folio`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('reservas')
    .update({ folio_alojamiento: folio })
    .eq('id', reservaId)

  cortarSiFalla(error, destino(reservaId), 'mover')
  revalidatePath(destino(reservaId))
  redirect(`${destino(reservaId)}?ok=movido`)
}

/** Guarda a nombre de quién se factura el folio B. */
export async function guardarTitularB(formData: FormData): Promise<void> {
  await exigirAcceso()

  const reservaId = String(formData.get('reserva_id') ?? '')
  const titular = String(formData.get('titular') ?? '').trim()
  if (!reservaId) redirect('/panel/reservas')

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('reservas')
    .update({ folio_b_titular: titular })
    .eq('id', reservaId)

  cortarSiFalla(error, destino(reservaId), 'titular')
  revalidatePath(destino(reservaId))
  redirect(`${destino(reservaId)}?ok=titular`)
}

export interface EstadoCargo {
  error?: string
  ok?: string
}

/**
 * Carga un cargo manual, con departamento y en cualquier moneda soportada.
 *
 * ── La conversión de moneda ─────────────────────────────────────────────────
 *
 * `consumos.precio_unitario` está **siempre en USD** (ADR 0003). Si el cargo se
 * cobró en pesos, se convierte con la cotización vigente y se guardan las tres
 * cosas: el importe en USD, el importe original y **la cotización usada**. Eso
 * último lo pide explícitamente el ADR 0003 por trazabilidad: sin ella, dentro de
 * seis meses nadie puede reconstruir por qué ese cargo dio ese número en dólares.
 *
 * Si no hay cotización disponible, el cargo en moneda extranjera **se rechaza** en
 * vez de inventar un tipo de cambio. Es la única operación del sistema donde una
 * cotización ausente bloquea algo, y es correcto: acá el número en dólares no
 * existe sin ella. Cargar en USD sigue funcionando siempre.
 */
export async function cargarManual(
  _prev: EstadoCargo,
  formData: FormData,
): Promise<EstadoCargo> {
  const sesion = await exigirAcceso()

  const reservaId = String(formData.get('reserva_id') ?? '')
  const concepto = String(formData.get('concepto') ?? '').trim()
  const departamentoId = String(formData.get('departamento_id') ?? '')
  const folio = String(formData.get('folio') ?? 'A')
  const comprobante = String(formData.get('comprobante') ?? '').trim()
  const moneda = String(formData.get('moneda') ?? 'USD').toUpperCase()
  const importe = Number(formData.get('importe'))
  const cantidad = Math.max(1, Math.trunc(Number(formData.get('cantidad')) || 1))

  if (!reservaId) return { error: 'Falta la reserva.' }
  if (!concepto) return { error: 'Escribí el concepto del cargo.' }
  if (!esFolio(folio)) return { error: 'El folio no es válido.' }
  if (!Number.isFinite(importe) || importe <= 0) {
    return { error: 'El importe tiene que ser mayor que cero.' }
  }

  // ── Conversión ────────────────────────────────────────────────────────────
  let precioUSD = importe
  let monedaOrigen: string | null = null
  let importeOrigen: number | null = null
  let cotizacionUsada: number | null = null

  if (moneda !== 'USD') {
    if (!esMonedaExtranjera(moneda)) return { error: 'Esa moneda no está soportada.' }

    const cotizacion = await cotizacionVigente(moneda)
    if (!cotizacion) {
      return {
        error:
          `No hay cotización disponible para ${moneda}, así que no se puede convertir el cargo a ` +
          `dólares. Cargalo en USD, o cargá la cotización a mano en Configuración.`,
      }
    }

    precioUSD = convertirAUSD(importe, cotizacion)
    if (precioUSD <= 0) return { error: 'La conversión dio cero. Revisá el importe y la cotización.' }

    monedaOrigen = moneda
    importeOrigen = importe
    cotizacionUsada = cotizacion.venta
  }

  const supabase = await crearClienteServidor()

  // ── El producto del cargo manual ───────────────────────────────────────────
  // `consumos.producto_id` es obligatorio y con FK, así que un cargo manual
  // necesita un producto contra el que apuntar. Se usa uno reservado del catálogo y
  // se crea la primera vez que hace falta: es preferible a hacer la columna
  // nullable, porque eso rompería las consultas que hoy asumen que hay producto.
  const { data: existente } = await supabase
    .from('productos_servicios')
    .select('id')
    .eq('codigo', 'CARGO-MANUAL')
    .maybeSingle<{ id: string }>()

  let productoId = existente?.id
  if (!productoId) {
    const { data: creado, error: eProducto } = await supabase
      .from('productos_servicios')
      .insert({
        codigo: 'CARGO-MANUAL',
        nombre: 'Cargo manual',
        categoria: 'otro',
        precio: 0,
        activo: true,
      })
      .select('id')
      .single<{ id: string }>()

    if (eProducto || !creado) {
      return { error: 'No se pudo preparar el cargo manual. Probá de nuevo.' }
    }
    productoId = creado.id
  }

  const { error } = await supabase.from('consumos').insert({
    reserva_id: reservaId,
    producto_id: productoId,
    cantidad,
    precio_unitario: precioUSD,
    folio,
    comprobante,
    // El concepto va en la nota: es lo que la cuenta muestra en la línea, ya que el
    // producto genérico diría siempre «Cargo manual».
    nota: concepto,
    departamento_id: departamentoId || null,
    moneda_origen: monedaOrigen,
    importe_origen: importeOrigen,
    cotizacion_usada: cotizacionUsada,
    cargado_por: sesion.userId,
  })

  if (error) return { error: 'No se pudo cargar. Probá de nuevo.' }

  revalidatePath(destino(reservaId))
  revalidatePath(`/panel/reservas/${reservaId}`)

  return {
    ok:
      monedaOrigen
        ? `Cargo agregado al folio ${folio}: ${monedaOrigen} ${importe.toLocaleString('es-AR')} = USD ${precioUSD.toLocaleString('es-AR')} (cotización ${cotizacionUsada}).`
        : `Cargo de USD ${precioUSD.toLocaleString('es-AR')} agregado al folio ${folio}.`,
  }
}
