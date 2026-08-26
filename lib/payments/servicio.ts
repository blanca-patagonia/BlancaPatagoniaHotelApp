import 'server-only'

/**
 * Iniciar un cobro en línea.
 *
 * Es el único camino por el que nace un link de pago, lo pida el portal público
 * o el mostrador. Está acá y no en cada Server Action porque los tres pasos
 * delicados son los mismos en los dos casos y equivocarse en cualquiera cuesta
 * plata:
 *
 * 1. **Congelar la cotización.** El importe en USD que va a saldar la reserva se
 *    decide ahora y queda escrito. Si se recalculara al confirmar el pago, el
 *    saldo de una reserva se movería con el dólar del día siguiente.
 * 2. **Escribir la fila `pendiente` ANTES de mandar al huésped a la pasarela.**
 *    Es la que vuelve idempotente al webhook y la que sabe cuánto se pidió
 *    cobrar. Sin ella, el evento que vuelve no tiene contra qué contrastarse.
 * 3. **No dejar dos links vivos por el mismo saldo.** Es el que más caro sale:
 *    dos links son dos cobros, y devolver uno es un trámite manual con la
 *    pasarela y una discusión con el huésped.
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { registrarFalla } from '@/lib/acciones'
import {
  calcularCobro,
  linkVigente,
  medioDeCobro,
  MONEDA_BASE,
  vencimientoDelLink,
  type MonedaCobro,
} from '@/lib/domain/cobro'
import { estaHabilitado, obtenerProveedor } from './index'
import { falloElCheckout, type UrlsDeRetorno } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any --
   Los clientes de Supabase del proyecto (usuario y admin) tienen tipos
   generados distintos, y este módulo tiene que aceptar los dos: el portal
   público cobra con `service_role` porque el huésped no tiene sesión, y el
   mostrador cobra con el cliente del usuario para que RLS y la auditoría vean
   quién lo hizo. Unificarlos pediría un genérico que se propaga a todo el
   archivo sin agregar seguridad real: las columnas se validan igual en la base. */
type Cliente = SupabaseClient<any, any, any>

export interface ParamsCobro {
  reservaId: string
  tipo: 'senia' | 'saldo'
  /** En USD. Es el saldo que se quiere cubrir. */
  montoUSD: number
  /** Nombre de la pasarela: `mercadopago`, `stripe` o `simulado`. */
  proveedor: string
  /** Lo que va a leer el huésped en la pasarela. */
  descripcion: string
  emailComprador?: string
  urls: UrlsDeRetorno
}

export type ResultadoCobro =
  | { url: string; externalId: string; reutilizado: boolean }
  | { error: string }

export function falloElCobro(r: ResultadoCobro): r is { error: string } {
  return 'error' in r
}

/**
 * Crea (o reutiliza) el link de pago de una reserva.
 *
 * Nunca lanza: devuelve `{ error }` con un mensaje en español que la pantalla
 * puede mostrar tal cual.
 */
export async function iniciarCobro(
  cliente: Cliente,
  p: ParamsCobro,
): Promise<ResultadoCobro> {
  if (!(p.montoUSD > 0)) {
    return { error: 'No hay saldo pendiente para cobrar.' }
  }

  if (!estaHabilitado(p.proveedor)) {
    return { error: 'Ese medio de pago no está habilitado.' }
  }

  const proveedor = obtenerProveedor(p.proveedor)
  if (!proveedor) return { error: 'Ese medio de pago no existe.' }

  const capacidades = proveedor.capacidades()
  if (!capacidades.cobraEnLinea) {
    return { error: 'Ese medio de pago no puede generar cobros en línea.' }
  }

  /*
    ¿Ya hay un link vivo para este mismo saldo?

    Se reutiliza en vez de crear otro. Dos links vivos por la misma seña son dos
    cobros posibles: el huésped abre el que le llegó por correo, no encuentra el
    mail, pide otro, y termina pagando los dos. Devolver esa plata es un trámite
    manual con la pasarela.
  */
  const existente = await linkReutilizable(cliente, p)
  if (existente) return existente

  /* ── 1. La moneda y la cotización, congeladas ── */

  const moneda = monedaDelProveedor(p.proveedor, capacidades.monedas)

  let cotizacion: number | null = null
  if (moneda !== MONEDA_BASE) {
    const vigente = await cotizacionVigente(moneda)
    // `venta` es la que se cobra: cuántas unidades cuesta comprar un dólar.
    cotizacion = vigente?.venta ?? null
    if (cotizacion === null) {
      return {
        error:
          `No hay cotización vigente de ${moneda}, así que no se puede cobrar en esa moneda. ` +
          `Cargá una en Configuración o cobrá en dólares.`,
      }
    }
  }

  const cobro = calcularCobro(p.montoUSD, moneda, cotizacion)
  if (!cobro) return { error: 'No se pudo calcular el importe a cobrar.' }

  /* ── 2. La fila `pendiente`, antes de mandar a nadie a la pasarela ── */

  const externalId = `bp_${randomUUID().replace(/-/g, '')}`
  const venceEn = vencimientoDelLink(new Date())

  const { data: fila, error: eInsert } = await cliente
    .from('pagos')
    .insert({
      reserva_id: p.reservaId,
      medio: proveedor.nombre,
      tipo: p.tipo,
      monto: cobro.monto,
      moneda: cobro.moneda,
      monto_cobrado: cobro.montoCobrado,
      cotizacion: cobro.cotizacion,
      estado: 'pendiente',
      external_id: externalId,
      vence_en: venceEn.toISOString(),
      nota: proveedor.esReal() ? '' : 'Cobro simulado: no se movió dinero.',
    })
    .select('id')
    .single()

  if (eInsert || !fila) {
    console.error(`[cobro] no se pudo registrar el pago pendiente: ${eInsert?.message}`)
    return { error: 'No se pudo registrar el cobro. Probá de nuevo en un momento.' }
  }

  /* ── 3. El checkout contra la pasarela ── */

  const checkout = await proveedor.crearCheckout({
    reservaId: p.reservaId,
    externalId,
    monto: cobro.montoCobrado,
    moneda: cobro.moneda,
    descripcion: p.descripcion,
    tipo: p.tipo,
    urls: p.urls,
    emailComprador: p.emailComprador,
    venceEn,
  })

  if (falloElCheckout(checkout)) {
    /*
      Compensación. La fila `pendiente` ya está escrita y no hay link: si
      quedara así, aparecería como un cobro en curso que nadie puede pagar y que
      además bloquearía el próximo intento (`linkReutilizable` la encontraría).

      Se marca `rechazado` en vez de borrarla: deja el rastro de que se intentó,
      y `pagos` no admite `delete` para el rol del mostrador (migración 0061).

      Va con `registrarFalla` y no con un corte: el error que hay que mostrarle a
      quien está esperando es el del checkout, no el de la compensación.
    */
    const { error: eCompensacion } = await cliente
      .from('pagos')
      .update({ estado: 'rechazado', nota: 'No se pudo crear el link de pago.' })
      .eq('id', fila.id)
    registrarFalla(eCompensacion, `anular el pago pendiente ${externalId}`)

    return { error: checkout.error }
  }

  /* ── 4. Guardar el link, para poder reenviarlo sin generar otro ── */

  const { error: eUrl } = await cliente
    .from('pagos')
    .update({ url_pago: checkout.url })
    .eq('id', fila.id)
  // No corta: el cobro ya es válido y el huésped está por ir a pagarlo. Lo que
  // se pierde es poder reenviar ESTE link, no el cobro.
  registrarFalla(eUrl, `guardar la url del pago ${externalId}`)

  return { url: checkout.url, externalId, reutilizado: false }
}

/**
 * El link vivo que ya existe para este saldo, si lo hay.
 *
 * «Vivo» es: mismo tipo de pago, todavía `pendiente`, sin vencer y con URL
 * guardada. Cualquier otra cosa no sirve para mandar de nuevo.
 */
async function linkReutilizable(
  cliente: Cliente,
  p: ParamsCobro,
): Promise<ResultadoCobro | null> {
  const { data, error } = await cliente
    .from('pagos')
    .select('external_id, url_pago, vence_en, monto')
    .eq('reserva_id', p.reservaId)
    .eq('tipo', p.tipo)
    .eq('estado', 'pendiente')
    .order('creado_en', { ascending: false })
    .limit(5)

  // Un fallo de lectura no debe impedir cobrar: se sigue y se crea uno nuevo.
  // El riesgo de dos links es menor que el de no poder cobrar nada.
  if (error) {
    registrarFalla(error, `buscar links de pago vivos de la reserva ${p.reservaId}`)
    return null
  }

  const ahora = new Date()
  for (const fila of data ?? []) {
    if (!fila.url_pago) continue
    if (!linkVigente(fila.vence_en, ahora)) continue
    // Si el saldo cambió —se cargaron consumos— el link viejo cobra de menos y
    // no sirve. Se deja vencer y se crea uno por el importe correcto.
    if (Math.abs(Number(fila.monto) - p.montoUSD) > 0.01) continue
    return { url: fila.url_pago, externalId: fila.external_id, reutilizado: true }
  }
  return null
}

/**
 * En qué moneda cobra este proveedor.
 *
 * Sale del catálogo (`MEDIOS_DE_COBRO`), que es lo que se le muestra al huésped,
 * y cae a la primera que declare el proveedor. Las dos fuentes tienen que decir
 * lo mismo; el catálogo manda porque es el que vio quien eligió.
 */
function monedaDelProveedor(
  nombre: string,
  soportadas: readonly MonedaCobro[],
): MonedaCobro {
  const delCatalogo = medioDeCobro(nombre)?.moneda
  if (delCatalogo && soportadas.includes(delCatalogo)) return delCatalogo
  return soportadas[0] ?? MONEDA_BASE
}
