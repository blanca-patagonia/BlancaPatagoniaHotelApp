'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirRol } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'
import { movimientoEnMoneda } from '@/lib/domain/cuentas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { esMonedaExtranjera } from '@/lib/domain/divisas'
import {
  avisosDelComprobante,
  esNotaDeCredito,
  leerQrDeFactura,
  nombreDeComprobante,
  numeroVisible,
  MENSAJES_QR_INVALIDO,
  TIPOS_COMPROBANTE_ARCA,
  type ComprobanteLeido,
} from '@/lib/domain/comprobante-qr'

const DESTINO = '/panel/proveedores/comprobantes'

/**
 * Carga de comprobantes recibidos (objetivo 9 del pedido).
 *
 * Es de **gerencia**, igual que el resto de cuentas por pagar: cargar una factura
 * de proveedor mueve lo que el hotel debe. Recepción puede *ver* la lista —para
 * saber si una factura ya está cargada antes de volver a escanearla— y eso lo
 * gobierna la política RLS de la 0080, no esta guarda.
 */
async function exigirGestion() {
  return requerirRol('admin', 'gerencia')
}

export interface EstadoComprobante {
  error?: string
  ok?: string
  /** Advertencias que NO impiden la carga. Ver `avisosDelComprobante`. */
  avisos?: string[]
  /** Resumen legible de lo que se cargó, para confirmarlo en pantalla. */
  resumen?: string
}

/**
 * Carga un comprobante a partir del texto del QR.
 *
 * El QR lo lee el **navegador** (cámara o archivo de imagen) y acá llega su texto.
 * La imagen no viaja al servidor y no se guarda en ninguna parte: guardar fotos de
 * facturas es gestión documental, tiene su propio ADR pendiente (0013) y meterlo
 * por la puerta de atrás dejaría archivos con datos fiscales sin política de
 * acceso ni de retención.
 */
export async function cargarComprobanteDesdeQr(
  _prev: EstadoComprobante,
  formData: FormData,
): Promise<EstadoComprobante> {
  const sesion = await exigirGestion()

  const texto = String(formData.get('qr') ?? '')
  const { comprobante, motivo } = leerQrDeFactura(texto)
  if (!comprobante) {
    return { error: MENSAJES_QR_INVALIDO[motivo ?? 'vacio'] }
  }

  const proveedorId = String(formData.get('proveedor_id') ?? '').trim() || null
  const razonSocial = String(formData.get('razon_social') ?? '').trim().slice(0, 120) || null

  return await guardar(comprobante, {
    origen: 'qr',
    proveedorId,
    razonSocial,
    cargadoPor: sesion.userId,
    cuitDelHotel: String(formData.get('cuit_hotel') ?? '').trim() || null,
  })
}

/**
 * Carga un comprobante escrito a mano.
 *
 * Es la salida para lo que el QR no cubre: un ticket, un remito, una factura
 * anterior a 2021, o un QR que no se deja leer porque el papel está arrugado. Se
 * guarda con `origen_dato = 'manual'` **y eso importa**: un número tipeado puede
 * estar mal y uno del QR no, así que quien revise el mes tiene que poder
 * distinguirlos.
 */
export async function cargarComprobanteAMano(
  _prev: EstadoComprobante,
  formData: FormData,
): Promise<EstadoComprobante> {
  const sesion = await exigirGestion()

  const cuit = String(formData.get('cuit_emisor') ?? '').replace(/\D/g, '')
  const tipoCodigo = Number(formData.get('tipo_codigo'))
  const puntoVenta = Number(formData.get('punto_venta'))
  const numero = Number(formData.get('numero'))
  const fecha = String(formData.get('fecha') ?? '')
  const total = Number(formData.get('total'))
  const moneda = String(formData.get('moneda') ?? 'ARS')
  const cae = String(formData.get('cae') ?? '').trim()

  if (!/^\d{11}$/.test(cuit)) return { error: 'El CUIT del emisor tiene que tener 11 dígitos.' }
  if (!TIPOS_COMPROBANTE_ARCA[tipoCodigo]) return { error: 'Elegí el tipo de comprobante.' }
  if (!Number.isInteger(puntoVenta) || puntoVenta < 0) return { error: 'Punto de venta inválido.' }
  if (!Number.isInteger(numero) || numero <= 0) return { error: 'Número de comprobante inválido.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'Elegí la fecha del comprobante.' }
  if (!Number.isFinite(total) || total < 0) return { error: 'El importe no es válido.' }
  if (moneda !== 'USD' && moneda !== 'ARS' && !esMonedaExtranjera(moneda)) {
    return { error: 'Esa moneda no está entre las que el sistema sabe convertir.' }
  }
  if (!cae) {
    return {
      error:
        'Falta el CAE. Si el comprobante no tiene —un ticket o un remito—, cargalo como gasto directo en la cuenta del proveedor.',
    }
  }

  const comprobante: ComprobanteLeido = {
    cuitEmisor: cuit,
    puntoVenta,
    numero,
    tipoCodigo,
    letra: TIPOS_COMPROBANTE_ARCA[tipoCodigo]?.letra ?? null,
    fecha,
    total,
    moneda,
    cotizacion: 1,
    cae,
    tipoAutorizacion: 'E',
    nroDocReceptor: null,
  }

  return await guardar(comprobante, {
    origen: 'manual',
    proveedorId: String(formData.get('proveedor_id') ?? '').trim() || null,
    razonSocial: String(formData.get('razon_social') ?? '').trim().slice(0, 120) || null,
    cargadoPor: sesion.userId,
    cuitDelHotel: null,
  })
}

/** El guardado, compartido por los dos caminos de carga. */
async function guardar(
  c: ComprobanteLeido,
  ctx: {
    origen: 'qr' | 'manual'
    proveedorId: string | null
    razonSocial: string | null
    cargadoPor: string
    cuitDelHotel: string | null
  },
): Promise<EstadoComprobante> {
  const supabase = await crearClienteServidor()

  const { error } = await supabase.from('comprobantes_recibidos').insert({
    cuit_emisor: c.cuitEmisor,
    tipo_codigo: c.tipoCodigo,
    letra: c.letra,
    punto_venta: c.puntoVenta,
    numero: c.numero,
    fecha: c.fecha,
    total: c.total,
    moneda: c.moneda,
    cotizacion: c.cotizacion,
    cae: c.cae,
    tipo_autorizacion: c.tipoAutorizacion,
    origen_dato: ctx.origen,
    razon_social: ctx.razonSocial,
    proveedor_id: ctx.proveedorId,
    cargado_por: ctx.cargadoPor,
  })

  // 23505 = ya estaba. No es un error de quien escanea: la primera foto salió
  // movida, volvió a intentar, y el comprobante ya había entrado. Se lo dice.
  if (error?.code === '23505') {
    return {
      error: `Ese comprobante ya estaba cargado (${nombreDeComprobante(c.tipoCodigo)} ${numeroVisible(c.puntoVenta, c.numero)}). No se duplicó.`,
    }
  }
  if (error) return { error: `No se pudo guardar el comprobante: ${error.message}` }

  revalidatePath(DESTINO)

  return {
    ok: 'Comprobante cargado.',
    resumen: `${nombreDeComprobante(c.tipoCodigo)} ${numeroVisible(c.puntoVenta, c.numero)} · ${c.moneda} ${c.total.toFixed(2)} · ${c.fecha}`,
    avisos: avisosDelComprobante(c, ctx.cuitDelHotel),
  }
}

/**
 * Imputa un comprobante a la cuenta corriente del proveedor.
 *
 * ── Por qué es un paso aparte y no automático ───────────────────────────────
 *
 * Cargar el comprobante es registrar que existe; imputarlo es decir que el hotel
 * lo debe. Son cosas distintas: una factura puede llegar con un error y estar en
 * discusión, o corresponder a otra sucursal. Imputar sola cada factura escaneada
 * metería en el libro mayor todo lo que alguien apuntó con la cámara.
 *
 * ⚠️ **Una nota de crédito se imputa como PAGO, no como cargo.** Devuelve plata:
 * cargarla como un gasto más inflaría lo que el hotel debe, que es justo al revés.
 */
export async function imputarComprobante(formData: FormData): Promise<void> {
  const sesion = await exigirGestion()

  const id = String(formData.get('comprobante_id') ?? '')
  const proveedorId = String(formData.get('proveedor_id') ?? '').trim()
  const vencimiento = String(formData.get('vencimiento') ?? '').trim()
  if (!id) redirect(DESTINO)
  if (!proveedorId) redirect(`${DESTINO}?error=sin_proveedor`)

  const supabase = await crearClienteServidor()

  const { data: comp, error: eLectura } = await supabase
    .from('comprobantes_recibidos')
    .select('id, tipo_codigo, punto_venta, numero, fecha, total, moneda, movimiento_id')
    .eq('id', id)
    .maybeSingle<{
      id: string
      tipo_codigo: number
      punto_venta: number
      numero: number
      fecha: string
      total: number | string
      moneda: string
      movimiento_id: string | null
    }>()

  cortarSiFalla(eLectura, DESTINO, 'imputar_lectura')
  if (!comp) redirect(`${DESTINO}?error=inexistente`)
  if (comp.movimiento_id) redirect(`${DESTINO}?error=ya_imputado`)

  // El importe entra en la moneda del comprobante y se guarda también en USD, que
  // es donde vive el saldo (migración 0078).
  const total = Number(comp.total)
  const vigente = comp.moneda === 'USD' ? null : await cotizacionVigente(comp.moneda as 'ARS')
  const mov = movimientoEnMoneda(total, comp.moneda, vigente?.venta ?? null)
  if (!mov) redirect(`${DESTINO}?error=sin_cotizacion`)

  const esNota = esNotaDeCredito(comp.tipo_codigo)

  const { data: movimiento, error: eMov } = await supabase
    .from('movimientos_proveedor')
    .insert({
      proveedor_id: proveedorId,
      // Una nota de crédito devuelve plata: entra como `pago`, que en esta cuenta
      // es lo que resta del saldo.
      tipo: esNota ? 'pago' : 'cargo',
      monto: mov.monto,
      moneda: mov.moneda,
      monto_origen: mov.montoOrigen,
      cotizacion: mov.cotizacion,
      concepto: nombreDeComprobante(comp.tipo_codigo),
      comprobante: numeroVisible(comp.punto_venta, comp.numero),
      fecha: comp.fecha,
      vencimiento: !esNota && vencimiento ? vencimiento : null,
      estado: esNota ? 'pagado' : 'pendiente',
      creado_por: sesion.userId,
    })
    .select('id')
    .single<{ id: string }>()

  cortarSiFalla(eMov, DESTINO, 'imputar')

  const { error: eVinculo } = await supabase
    .from('comprobantes_recibidos')
    .update({ movimiento_id: movimiento?.id ?? null, proveedor_id: proveedorId })
    .eq('id', id)

  /*
    Si esto falla, el asiento contable YA existe.

    No se deshace: la deuda con el proveedor es real y perderla es el fallo más
    caro de los dos. Lo que queda roto es el vínculo, así que el comprobante
    figuraría sin imputar y alguien podría imputarlo de nuevo —por eso el índice
    único parcial de la 0080 sobre `movimiento_id`, que impide que un mismo
    movimiento quede respaldado por dos comprobantes—. Se avisa y se sigue.
  */
  cortarSiFalla(eVinculo, DESTINO, 'imputar_vinculo')

  revalidatePath(DESTINO)
  revalidatePath(`/panel/proveedores/${proveedorId}`)
  redirect(`${DESTINO}?ok=imputado`)
}
