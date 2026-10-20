'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { movimientoEnMoneda } from '@/lib/domain/cuentas'
import { esMonedaExtranjera } from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { cortarSiFalla, registrarFalla, mensajeDeFalla } from '@/lib/acciones'
import { subirAdjunto, eliminarAdjunto } from '@/lib/storage'
import { registrarAviso } from '@/lib/registro'

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
  if (error) return { error: mensajeDeFalla(error, 'proveedores:crear', 'No se pudo crear el proveedor') }
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

/**
 * Salda un comprobante del proveedor: registra el PAGO por su importe y lo
 * marca como pagado.
 *
 * Antes sólo cambiaba el estado del cargo, sin pago: el saldo (cargos − pagos,
 * vista `saldos_proveedores`) seguía diciendo que se debía, mientras el informe
 * de antigüedad lo daba por cancelado. Las dos cifras se contradecían.
 *
 * El cargo se RECLAMA primero con un `update` condicional (sólo si sigue
 * pendiente o vencido): dos clics o dos pestañas no generan dos pagos. Si el
 * pago no se puede registrar, el cargo vuelve a su estado anterior.
 */
export async function marcarComprobantePagado(formData: FormData): Promise<void> {
  await exigirGestion()
  const id = String(formData.get('movimiento_id') ?? '')
  const proveedorId = String(formData.get('proveedor_id') ?? '')
  const destino = `/panel/proveedores/${proveedorId}`
  if (!id) redirect(destino)

  const supabase = await crearClienteServidor()
  const { data: reclamados, error: eReclamo } = await supabase
    .from('movimientos_proveedor')
    .update({ estado: 'pagado' })
    .eq('id', id)
    .eq('proveedor_id', proveedorId)
    .eq('tipo', 'cargo')
    .in('estado', ['pendiente', 'vencido'])
    .select('estado, monto, moneda, monto_origen, cotizacion, concepto, comprobante')
  cortarSiFalla(eReclamo, destino, 'pagado')
  const cargo = reclamados?.[0] as
    | {
        monto: number
        moneda: string
        monto_origen: number | null
        cotizacion: number | null
        concepto: string
        comprobante: string | null
      }
    | undefined
  // Ya estaba saldado (otra pestaña, otro usuario) o no es un cargo de este proveedor.
  if (!cargo) redirect(`${destino}?error=ya_saldado`)

  const { error: ePago } = await supabase.from('movimientos_proveedor').insert({
    proveedor_id: proveedorId,
    tipo: 'pago',
    monto: cargo.monto,
    moneda: cargo.moneda,
    monto_origen: cargo.monto_origen,
    cotizacion: cargo.cotizacion,
    concepto: `Pago: ${cargo.concepto}`,
    comprobante: cargo.comprobante,
    estado: 'pagado',
  })
  if (ePago) {
    // Compensación: el cargo vuelve a pendiente. Se registra sin cortar, para
    // que lo que se muestre sea el error original (ver `registrarFalla`).
    const { error: eVuelta } = await supabase
      .from('movimientos_proveedor')
      .update({ estado: 'pendiente' })
      .eq('id', id)
    registrarFalla(eVuelta, `revertir el saldado del comprobante ${id}`)
    cortarSiFalla(ePago, destino, 'pagado')
  }
  redirect(destino)
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

/**
 * Quita una foto/documento de un proveedor: del arreglo `fotos` y del bucket.
 * Mismo criterio que `eliminarFotoOrden` en mantenimiento: se actualiza la
 * base primero y recién después se borra el archivo, para no dejar la ficha
 * mostrando una foto que ya no existe si el borrado del bucket fallara.
 */
export async function eliminarFotoProveedor(formData: FormData): Promise<void> {
  await exigirGestion()

  const proveedorId = String(formData.get('proveedor_id') ?? '')
  const ruta = String(formData.get('ruta') ?? '')
  if (!proveedorId || !ruta) redirect(`/panel/proveedores/${proveedorId}?error=foto_eliminar`)

  const supabase = await crearClienteServidor()
  const { data: actual, error: errorLectura } = await supabase
    .from('proveedores')
    .select('fotos')
    .eq('id', proveedorId)
    .single()
  if (errorLectura) {
    cortarSiFalla(errorLectura, `/panel/proveedores/${proveedorId}`, 'foto_leer')
  }

  const previas = ((actual as { fotos: string[] } | null)?.fotos) ?? []
  /*
    Sólo se borra un archivo que de verdad era de esta entidad. La ruta viene
    del formulario y el borrado del bucket va con `service_role`: sin esta
    guarda, cualquiera con acceso al módulo podía borrar CUALQUIER archivo del
    bucket (por ejemplo, el comprobante de pago de una agencia) mandando su ruta.
  */
  if (!previas.includes(ruta)) redirect(`/panel/proveedores/${proveedorId}?error=foto_eliminar`)
  const fotos = previas.filter((f) => f !== ruta)
  const { error } = await supabase
    .from('proveedores')
    .update({ fotos })
    .eq('id', proveedorId)
  cortarSiFalla(error, `/panel/proveedores/${proveedorId}`, 'foto_eliminar')

  await eliminarAdjunto(ruta)
  await registrarAviso('adjunto_eliminado', { modulo: 'proveedores', proveedor_id: proveedorId, ruta })

  revalidatePath(`/panel/proveedores/${proveedorId}`)
  redirect(`/panel/proveedores/${proveedorId}?ok=foto_eliminada`)
}
