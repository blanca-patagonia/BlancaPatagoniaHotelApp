'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'
import { leerExtracto } from '@/lib/conciliacion/extracto-csv'
import { importarMovimientos } from '@/lib/conciliacion/servicio'
import { proveedorMercadoPagoReportes } from '@/lib/conciliacion/mercadopago-reportes'
import { esMonedaExtranjera } from '@/lib/domain/divisas'

const DESTINO = '/panel/conciliacion'

/**
 * Acciones de conciliación.
 *
 * Todas exigen el área `conciliacion`, que en `lib/domain/permisos.ts` es de admin
 * y gerencia. Es el extracto bancario del hotel —sueldos, proveedores, todo lo que
 * pasó por la cuenta— y no sólo lo que tiene que ver con las reservas.
 */

/* ─────────────────────────────────────────── subir el extracto ──────────── */

export interface EstadoImportacionExtracto {
  error?: string
  ok?: string
  advertencia?: string
  /**
   * Filas que quedaron afuera, con su posición en el archivo (sin contar las
   * líneas en blanco — ver `FilaDescartada`).
   */
  descartadas?: { fila: number; motivo: string }[]
}

/**
 * Tope de tamaño del archivo.
 *
 * Un extracto mensual de una cuenta de hotel son unas cientos de líneas: bastante
 * menos de un megabyte. El límite existe para que un archivo equivocado —un PDF,
 * un ZIP— no se lea entero en memoria antes de descubrir que no era un CSV.
 */
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Importa un extracto bancario en CSV.
 *
 * Devuelve estado en vez de redirigir porque el resultado es **detallado**: de 200
 * líneas puede haber 3 que no se leyeron, y hay que poder verlas con su número de
 * línea. Eso no cabe en un `?error=` de la URL, y resumirlo a «hubo errores» deja
 * a quien importa sin nada que corregir.
 */
export async function importarExtracto(
  _prev: EstadoImportacionExtracto,
  formData: FormData,
): Promise<EstadoImportacionExtracto> {
  const sesion = await requerirAcceso('conciliacion')

  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Elegí el archivo del extracto que bajaste del Home Banking.' }
  }
  if (archivo.size > MAX_BYTES) {
    return { error: 'El archivo es demasiado grande. ¿Seguro que es el extracto de la cuenta?' }
  }

  const moneda = String(formData.get('moneda') ?? 'ARS')
  if (moneda !== 'USD' && !esMonedaExtranjera(moneda)) {
    return { error: 'Elegí una moneda que el sistema sepa manejar.' }
  }
  const cuenta = String(formData.get('cuenta') ?? '').trim().slice(0, 60) || null

  const lectura = leerExtracto(await archivo.text(), { origen: 'banco', cuenta, moneda })
  if (lectura.error) return { error: lectura.error }
  if (lectura.movimientos.length === 0) {
    return {
      error:
        'No se pudo leer ningún movimiento del archivo. Revisá que sea el extracto de movimientos y no el resumen de cuenta.',
      descartadas: lectura.descartadas.slice(0, 20),
    }
  }

  const resultado = await importarMovimientos(lectura.movimientos, sesion.userId)
  if (!resultado.ok) return { error: resultado.error }

  revalidatePath(DESTINO)

  const partes = [`Se importaron ${resultado.nuevos} movimientos nuevos.`]
  if (resultado.repetidos > 0) {
    partes.push(`${resultado.repetidos} ya estaban y no se duplicaron.`)
  }
  if (resultado.conciliados > 0) {
    partes.push(`${resultado.conciliados} se conciliaron solos por referencia.`)
  }

  return {
    ok: partes.join(' '),
    // Las fechas ambiguas son el aviso que no se puede callar: `03/04/2026` es el
    // 3 de abril o el 4 de marzo, y el archivo no dice cuál.
    advertencia: lectura.fechasAmbiguas
      ? 'Algunas fechas venían en formato ambiguo (día/mes contra mes/día). Se interpretaron como día/mes; revisá que los movimientos hayan quedado en el mes correcto.'
      : undefined,
    descartadas: lectura.descartadas.length > 0 ? lectura.descartadas.slice(0, 20) : undefined,
  }
}

/* ────────────────────────────────────── traer de MercadoPago ────────────── */

export interface EstadoTraerLiquidacion {
  error?: string
  ok?: string
}

/**
 * Trae el reporte de liquidaciones de MercadoPago de un período.
 *
 * ⚠️ La generación del reporte es **asincrónica** del lado de MercadoPago: la
 * primera vez el sistema lo pide y hay que volver a apretar en unos minutos. No se
 * hace polling acá — dejar la petición del panel esperando a un tercero es la
 * forma de que la pantalla quede colgada sin que nadie sepa por qué.
 */
export async function traerLiquidacionMercadoPago(
  _prev: EstadoTraerLiquidacion,
  formData: FormData,
): Promise<EstadoTraerLiquidacion> {
  const sesion = await requerirAcceso('conciliacion')

  const desde = String(formData.get('desde') ?? '')
  const hasta = String(formData.get('hasta') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return { error: 'Elegí el período: desde y hasta.' }
  }
  if (desde > hasta) return { error: 'La fecha «desde» tiene que ser anterior a «hasta».' }

  const proveedor = proveedorMercadoPagoReportes()
  if (!proveedor) {
    return {
      error:
        'Falta configurar MercadoPago. Se usa el mismo token que el cobro en línea (MERCADOPAGO_ACCESS_TOKEN).',
    }
  }

  const resultado = await proveedor.consultar({ desde, hasta })
  if (!resultado.ok) return { error: resultado.error }

  const importado = await importarMovimientos(resultado.movimientos, sesion.userId)
  if (!importado.ok) return { error: importado.error }

  revalidatePath(DESTINO)

  const partes = [`Se trajeron ${importado.nuevos} movimientos nuevos de MercadoPago.`]
  if (importado.repetidos > 0) partes.push(`${importado.repetidos} ya estaban.`)
  if (importado.conciliados > 0) {
    partes.push(`${importado.conciliados} se conciliaron solos por referencia.`)
  }
  return { ok: partes.join(' ') }
}

/* ──────────────────────────────────────── conciliar a mano ──────────────── */

/**
 * Concilia un movimiento contra un pago, o lo marca como ignorado.
 *
 * ── Por qué esto lo decide una persona ──────────────────────────────────────
 *
 * Lo que coincide por referencia ya se cerró solo al importar. Lo que llega acá
 * coincide por importe y fecha, y eso **no alcanza**: dos huéspedes que pagan la
 * misma seña el mismo día es lo más común del mundo, y casar el cobro con la
 * reserva equivocada deja a uno figurando impago y al otro pagado sin haber
 * pagado. Un automatismo que se equivoca ahí no lo revisa nadie más.
 */
export async function resolverMovimiento(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('conciliacion')

  const id = String(formData.get('movimiento_id') ?? '')
  const accion = String(formData.get('accion') ?? '')
  const pagoId = String(formData.get('pago_id') ?? '').trim()
  const nota = String(formData.get('nota') ?? '').trim().slice(0, 500)
  if (!id) redirect(DESTINO)

  const supabase = await crearClienteServidor()

  if (accion === 'ignorar') {
    // Ignorar sin explicación es esconder: el movimiento desaparece de lo pendiente
    // y en la revisión siguiente nadie sabe si estaba bien ignorarlo.
    if (nota.length < 5) redirect(`${DESTINO}?error=ignorar_motivo`)

    const { error } = await supabase
      .from('movimientos_externos')
      .update({
        estado: 'ignorado',
        pago_id: null,
        nota,
        conciliado_por: sesion.userId,
        conciliado_en: new Date().toISOString(),
      })
      .eq('id', id)
    cortarSiFalla(error, DESTINO, 'resolver')
    revalidatePath(DESTINO)
    redirect(`${DESTINO}?ok=ignorado`)
  }

  if (accion === 'reabrir') {
    const { error } = await supabase
      .from('movimientos_externos')
      .update({
        estado: 'sin_conciliar',
        pago_id: null,
        nota: null,
        conciliado_por: null,
        conciliado_en: null,
      })
      .eq('id', id)
    cortarSiFalla(error, DESTINO, 'resolver')
    revalidatePath(DESTINO)
    redirect(`${DESTINO}?ok=reabierto`)
  }

  if (accion !== 'conciliar') redirect(DESTINO)
  if (!pagoId) redirect(`${DESTINO}?error=sin_pago`)

  const { error } = await supabase
    .from('movimientos_externos')
    .update({
      estado: 'conciliado',
      pago_id: pagoId,
      nota: nota || 'Conciliado a mano.',
      conciliado_por: sesion.userId,
      conciliado_en: new Date().toISOString(),
    })
    .eq('id', id)

  // 23505 = ese pago ya está conciliado contra otro movimiento. La base lo impide
  // con un índice parcial (0077) y acá se traduce a un mensaje que se entiende:
  // contar el mismo cobro dos veces descuadraría el arqueo.
  if (error?.code === '23505') redirect(`${DESTINO}?error=pago_ya_conciliado`)
  cortarSiFalla(error, DESTINO, 'resolver')

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?ok=conciliado`)
}
