'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { movimientoEnMoneda } from '@/lib/domain/cuentas'
import { esMonedaExtranjera } from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { cortarSiFalla } from '@/lib/acciones'
import { subirAdjunto } from '@/lib/storage'

export interface EstadoProveedor {
  error?: string
  ok?: string
  /** Id del proveedor recién creado, para ofrecer el enlace a su cuenta. */
  id?: string
}

async function exigirGestion() {
  await requerirAcceso('proveedores')
}

export async function crearProveedor(
  _prev: EstadoProveedor,
  formData: FormData,
): Promise<EstadoProveedor> {
  await exigirGestion()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const rubro = String(formData.get('rubro') ?? '').trim()
  const cuit = String(formData.get('cuit') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim()
  if (!nombre) return { error: 'Ingresá el nombre.' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('proveedores')
    .insert({
      nombre,
      rubro: rubro || null,
      cuit: cuit || null,
      email: email || null,
      telefono: telefono || null,
    })
    .select('id')
    .single()
  if (error) return { error: `No se pudo crear: ${error.message}` }
  revalidatePath('/panel/proveedores')
  return { ok: `Se registró ${nombre}.`, id: (data as { id: string } | null)?.id }
}

/**
 * Registra una factura del proveedor (cargo) o un pago nuestro.
 *
 * El **vencimiento** solo tiene sentido en los cargos: es lo que alimenta el
 * reporte de antigüedad de saldos. Un pago se marca como saldado en el acto.
 *
 * ── La moneda (auditoría 2026-09, P1-3) ─────────────────────────────────────
 *
 * Es el caso más frecuente del hallazgo: **el proveedor local factura en pesos**.
 * Quien carga la factura de la lavandería escribe «185000», porque es lo que dice
 * el papel, y hasta esta corrección eso entraba como USD 185.000 al saldo, al
 * KPI de deuda del panel y al aging report.
 *
 * Ahora el importe se ingresa en la moneda del comprobante y se guardan las dos
 * cosas: `monto` en USD —lo único que suma el saldo— y `monto_origen`, que es el
 * número contra el que se concilia el papel.
 */
export async function registrarMovimientoProveedor(formData: FormData): Promise<void> {
  await exigirGestion()
  const proveedorId = String(formData.get('proveedor_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  const montoIngresado = Number(formData.get('monto') ?? 0)
  const moneda = String(formData.get('moneda') ?? 'USD')
  const concepto = String(formData.get('concepto') ?? '').trim()
  const vencimiento = String(formData.get('vencimiento') ?? '')
  const comprobante = String(formData.get('comprobante') ?? '').trim()

  if (proveedorId && ['cargo', 'pago'].includes(tipo) && montoIngresado > 0) {
    if (moneda !== 'USD' && !esMonedaExtranjera(moneda)) {
      redirect(`/panel/proveedores/${proveedorId}?error=moneda`)
    }

    const vigente = moneda === 'USD' ? null : await cotizacionVigente(moneda)
    const mov = movimientoEnMoneda(montoIngresado, moneda, vigente?.venta ?? null)
    // Sin cotización no se inventa una: la deuda con un proveedor real se movería
    // con un tipo de cambio que después nadie puede justificar.
    if (!mov) redirect(`/panel/proveedores/${proveedorId}?error=sin_cotizacion`)

    const esCargo = tipo === 'cargo'
    const supabase = await crearClienteServidor()
    // Un cargo o un pago que no se registra descuadra lo que el hotel debe.
    const { error } = await supabase.from('movimientos_proveedor').insert({
      proveedor_id: proveedorId,
      tipo,
      monto: mov.monto,
      moneda: mov.moneda,
      monto_origen: mov.montoOrigen,
      cotizacion: mov.cotizacion,
      concepto,
      comprobante: comprobante || null,
      vencimiento: esCargo && vencimiento ? vencimiento : null,
      estado: esCargo ? 'pendiente' : 'pagado',
    })
    cortarSiFalla(error, `/panel/proveedores/${proveedorId}`, 'movimiento')
  }
  redirect(`/panel/proveedores/${proveedorId}`)
}

/** Marca una factura del proveedor como saldada. */
export async function marcarComprobantePagado(formData: FormData): Promise<void> {
  await exigirGestion()
  const id = String(formData.get('movimiento_id') ?? '')
  const proveedorId = String(formData.get('proveedor_id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('movimientos_proveedor')
      .update({ estado: 'pagado' })
      .eq('id', id)
    cortarSiFalla(error, `/panel/proveedores/${proveedorId}`, 'pagado')
  }
  redirect(`/panel/proveedores/${proveedorId}`)
}

/**
 * Marca como vencidos los cargos impagos pasados de fecha.
 *
 * Delega en la función SQL `vencer_comprobantes_proveedor()`; hoy se dispara a
 * mano, en producción iría por cron.
 */
export async function vencerComprobantes(): Promise<void> {
  await exigirGestion()
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('vencer_comprobantes_proveedor')
  // Sin esto, un RPC que falla termina en «?vencidos=0» — igual que si de
  // verdad no hubiera ningún comprobante para vencer.
  cortarSiFalla(error, '/panel/proveedores', 'vencer_comprobantes')
  redirect(`/panel/proveedores?vencidos=${data ?? 0}`)
}

/** Actualiza los datos del proveedor. */
export async function actualizarProveedor(formData: FormData): Promise<void> {
  await exigirGestion()
  const id = String(formData.get('proveedor_id') ?? '')
  if (!id) redirect('/panel/proveedores')

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('proveedores')
    .update({
      nombre: String(formData.get('nombre') ?? '').trim(),
      rubro: String(formData.get('rubro') ?? '').trim() || null,
      cuit: String(formData.get('cuit') ?? '').trim() || null,
      email: String(formData.get('email') ?? '').trim() || null,
      telefono: String(formData.get('telefono') ?? '').trim() || null,
    })
    .eq('id', id)
  cortarSiFalla(error, `/panel/proveedores/${id}`, 'datos')

  revalidatePath(`/panel/proveedores/${id}`)
  redirect(`/panel/proveedores/${id}?ok=datos`)
}

/** Activa o desactiva el proveedor conservando su historial de movimientos. */
export async function alternarActivoProveedor(formData: FormData): Promise<void> {
  await exigirGestion()
  const id = String(formData.get('proveedor_id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('proveedores').update({ activo: !activo }).eq('id', id)
    cortarSiFalla(error, `/panel/proveedores/${id}`, 'activo')
  }
  revalidatePath('/panel/proveedores')
  redirect(`/panel/proveedores/${id}`)
}

/**
 * Adjunta una foto/documento nuevo a un proveedor (ADR 0037).
 *
 * Sube el archivo a `proveedores/<proveedor_id>` con `subirAdjunto` y agrega
 * la RUTA devuelta al arreglo `fotos` — nunca se guarda una URL ni el archivo
 * en la base, sólo el nombre dentro del bucket privado. Es documentación del
 * proveedor (habilitación, seguro, lo que corresponda), no las facturas
 * escaneadas por QR de `/panel/proveedores/comprobantes`.
 *
 * Se lee el arreglo actual y se reescribe con la ruta nueva en vez de un
 * `array_append` en la base: el volumen es una foto por vez, cargada por una
 * sola persona, así que la ventana de carrera es despreciable frente a la
 * simplicidad de no sumar una función SQL sólo para esto (mismo patrón que
 * `agregarFotoOrden` en mantenimiento).
 */
export async function agregarFotoProveedor(formData: FormData): Promise<void> {
  await exigirGestion()

  const proveedorId = String(formData.get('proveedor_id') ?? '')
  const archivo = formData.get('foto')
  if (!proveedorId || !(archivo instanceof File) || archivo.size === 0) {
    redirect(`/panel/proveedores/${proveedorId}?error=foto_falta`)
  }

  const subida = await subirAdjunto(`proveedores/${proveedorId}`, archivo)
  if ('error' in subida) {
    redirect(`/panel/proveedores/${proveedorId}?error=foto_subida`)
  }

  const supabase = await crearClienteServidor()
  const { data: actual, error: errorLectura } = await supabase
    .from('proveedores')
    .select('fotos')
    .eq('id', proveedorId)
    .single()
  if (errorLectura) {
    cortarSiFalla(errorLectura, `/panel/proveedores/${proveedorId}`, 'foto_leer')
  }

  const fotos = [...(((actual as { fotos: string[] } | null)?.fotos) ?? []), subida.ruta]
  const { error } = await supabase
    .from('proveedores')
    .update({ fotos })
    .eq('id', proveedorId)
  cortarSiFalla(error, `/panel/proveedores/${proveedorId}`, 'foto_guardar')

  revalidatePath(`/panel/proveedores/${proveedorId}`)
  redirect(`/panel/proveedores/${proveedorId}?ok=foto`)
}
