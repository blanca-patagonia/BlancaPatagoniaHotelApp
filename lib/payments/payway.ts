import 'server-only'

/**
 * Payway (Prisma / ex-Decidir) — posnet y tarjeta local.
 *
 * Ver ADR 0038 para el porqué completo. Resumen de lo que la distingue de
 * MercadoPago y Stripe (las otras dos pasarelas reales, ver `mercadopago.ts`):
 *
 * 1. **No hay checkout alojado por el proveedor.** Payway resuelve el pago en
 *    dos llamadas que hace el propio integrador: tokenizar la tarjeta desde el
 *    NAVEGADOR con la llave pública (el PAN nunca toca este servidor) y
 *    ejecutar el pago desde el SERVIDOR con la llave privada y ese token. Por
 *    eso `crearCheckout` no devuelve la URL de Payway: devuelve la URL de una
 *    pantalla PROPIA (`/pago-payway/[reservaId]`), que es la que carga el
 *    script de tokenización.
 * 2. **La respuesta de pago es síncrona.** No hay webhook real de Payway para
 *    una tarjeta. `verificarFirma`/`parsearWebhook` sí hacen algo, pero de un
 *    evento que genera el propio sistema después de una respuesta `approved`
 *    de Payway — mismo patrón que ya usa `ProveedorSimulado` /
 *    `app/pago-simulado/actions.ts` para ejercitar el pipeline de `pagos` sin
 *    inventar un camino de escritura paralelo. Ver `ejecutarPagoPayway` más
 *    abajo, que es lo que arma y firma ese evento.
 * 3. **El importe va en CENTAVOS** (`amount: 15050` son $150,50) — la misma
 *    trampa que ya tiene Stripe (ver AGENTS.md), documentada acá aparte porque
 *    es un proveedor distinto y el error es fácil de repetir sin darse cuenta.
 *
 * ⚠️ ESCRITO CONTRA LA DOCUMENTACIÓN PÚBLICA, NO CONTRA UNA CUENTA DE PRUEBA.
 * Igual que Mercado Pago y Stripe cuando se integraron (ADR 0027): el código
 * sigue el contrato que documentan públicamente los SDKs de Payway
 * (`github.com/payway-ar/sdk-*`, `developers.payway.com.ar`), pero no hay
 * credenciales de sandbox para ejercitarlo de punta a punta. Antes de cobrar
 * de verdad, confirmar con Soporte Payway (los da el equipo comercial al
 * contratar): el nombre exacto del header de autenticación (acá `apikey`,
 * que es lo que documentan los SDKs oficiales) y la URL base de producción
 * (acá `https://ventasonline.payway.com.ar/api/v2`, la que usa el SDK de
 * JavaScript; el SDK de PHP menciona en cambio `live.decidir.com` para el
 * mismo servicio — son la marca vieja y la nueva del mismo gateway, y
 * conviene confirmar cuál resuelve para la cuenta contratada antes de activar
 * `PAGO_PROVIDER=payway` en producción).
 */

import { verificarFirmaWebhook, firmar } from '@/lib/integraciones/firma-webhook'
import { esProduccion } from '@/lib/integraciones/seleccion'
import { registrarError } from '@/lib/registro'
import {
  ESTADOS_PAGO,
  TIPOS_PAGO,
  type MedioPago,
  type TipoPago,
  type EstadoPago,
} from '@/lib/domain/pagos'
import { MONEDA_BASE, type MonedaCobro } from '@/lib/domain/cobro'
import { esMonedaDeCobro } from './simulado'
import type {
  CapacidadesPago,
  CheckoutParams,
  DatosTarjeta,
  PaymentProvider,
  ResultadoCheckout,
  ResultadoVerificacionTarjeta,
  ResultadoWebhook,
} from './tipos'

const BASE_SANDBOX = 'https://developers.decidir.com/api/v2'
const BASE_PRODUCCION = 'https://ventasonline.payway.com.ar/api/v2'

/** Base de la API según el ambiente. Ver la advertencia del docblock del módulo. */
function baseApi(): string {
  return esProduccion() ? BASE_PRODUCCION : BASE_SANDBOX
}

const TIMEOUT_MS = 10_000

/** Payway informa el importe en centavos: `15050` son $150,50. */
export function aCentavos(monto: number): number {
  return Math.round(monto * 100)
}

/** Estados de la respuesta de Payway → estados del dominio. */
function traducirEstado(status: string): EstadoPago | null {
  switch (status) {
    case 'approved':
      return 'aprobado'
    case 'rejected':
      return 'rechazado'
    default:
      // Payway no tiene un «pending» de tarjeta: la respuesta es síncrona.
      // Cualquier otra cosa es un estado que este código no conoce — mejor
      // rechazar el evento que inventarle una traducción a algo que mueve dinero.
      return null
  }
}

export class ProveedorPayway implements PaymentProvider {
  readonly nombre: MedioPago = 'payway'

  esReal(): boolean {
    return true
  }

  capacidades(): CapacidadesPago {
    return {
      // Ver el docblock: no está probado contra una cuenta real, así que se
      // mantiene la misma declaración conservadora que Mercado Pago y Stripe
      // (ADR 0025) en vez de prometer una preautorización sin haberla ejercitado.
      verificaTarjeta: false,
      cobraEnLinea: true,
      // Payway liquida en pesos argentinos, igual que Mercado Pago Checkout Pro.
      monedas: ['ARS'],
    }
  }

  async verificarTarjeta(datos: DatosTarjeta): Promise<ResultadoVerificacionTarjeta> {
    const digitos = datos.numero.replace(/\D/g, '')
    return {
      ok: false,
      noSoportado: true,
      ultimos4: digitos.length >= 4 ? digitos.slice(-4) : undefined,
      vencimiento: datos.vencimiento,
      detalle: 'Payway no está integrado para preautorizar tarjetas de garantía. Ver ADR 0025.',
    }
  }

  /**
   * Manda a la pantalla de checkout PROPIA. A diferencia de Mercado Pago y
   * Stripe, acá no hay nada que crear contra la pasarela todavía: Payway
   * recién entra en juego cuando el huésped tokeniza la tarjeta en esa
   * pantalla. Lo único que hace falta es empaquetar los datos del cobro para
   * que la pantalla los muestre y, al terminar, ejecute el pago con el monto
   * correcto (nunca uno que el navegador pueda alterar sin que se note: el
   * webhook interno vuelve a validar contra `pagos.external_id`, igual que
   * cualquier otro proveedor).
   */
  async crearCheckout(p: CheckoutParams): Promise<ResultadoCheckout> {
    if (p.moneda !== 'ARS') {
      return { error: 'Payway solo cobra en pesos argentinos (ARS).' }
    }
    const q = new URLSearchParams({
      external_id: p.externalId,
      reserva_id: p.reservaId,
      monto: String(p.monto),
      moneda: p.moneda,
      tipo: p.tipo,
      descripcion: p.descripcion,
      volver: p.urls.exito,
      cancelar: p.urls.error,
    })
    return { url: `/pago-payway/${p.reservaId}?${q.toString()}`, externalId: p.externalId }
  }

  /**
   * No verifica un aviso de Payway: verifica el evento que genera nuestro
   * propio servidor en `ejecutarPagoPayway`, con el mismo mecanismo de HMAC
   * que ya usa `ProveedorSimulado`, pero con un secreto propio
   * (`PAYWAY_INTERNAL_SECRET`) — no el de ninguna pasarela real. Lo que esta
   * firma certifica es «esto lo generó nuestro propio servidor después de una
   * respuesta `approved` de Payway», no «esto lo mandó Payway».
   */
  async verificarFirma(req: Request): Promise<boolean> {
    const secreto = process.env.PAYWAY_INTERNAL_SECRET?.trim()
    if (!secreto) {
      if (process.env.NODE_ENV === 'production') {
        await registrarError('webhook_pago_sin_secreto', { proveedor: 'payway' })
        return false
      }
      return true
    }

    const cuerpo = await req.text()
    const { valida, motivo } = await verificarFirmaWebhook(secreto, req.headers, cuerpo)
    if (!valida) {
      await registrarError('webhook_pago_firma_invalida', { proveedor: 'payway', motivo })
    }
    return valida
  }

  /** Mismo formato de evento interno que `ProveedorSimulado`, ver ese archivo. */
  async parsearWebhook(req: Request): Promise<ResultadoWebhook> {
    let cuerpo: Record<string, unknown>
    try {
      cuerpo = await req.json()
    } catch {
      return { tipo: 'invalido', motivo: 'el cuerpo no es JSON' }
    }

    const externalId = String(cuerpo.external_id ?? '')
    const reservaId = String(cuerpo.reserva_id ?? '')
    const monto = Number(cuerpo.monto ?? 0)
    if (!externalId) return { tipo: 'invalido', motivo: 'falta external_id' }
    if (!(monto > 0)) return { tipo: 'invalido', motivo: 'el monto no es positivo' }

    const tipo = cuerpo.tipo ?? 'saldo'
    if (!TIPOS_PAGO.includes(tipo as TipoPago)) {
      return { tipo: 'invalido', motivo: `tipo de pago desconocido: ${String(tipo)}` }
    }

    const estado = cuerpo.estado
    if (!ESTADOS_PAGO.includes(estado as EstadoPago)) {
      return { tipo: 'invalido', motivo: `estado de pago desconocido: ${String(estado)}` }
    }

    const moneda = String(cuerpo.moneda ?? MONEDA_BASE)
    if (!esMonedaDeCobro(moneda)) {
      return { tipo: 'invalido', motivo: `moneda desconocida: ${moneda}` }
    }

    return {
      tipo: 'evento',
      evento: {
        externalId,
        reservaId,
        monto,
        moneda: moneda as MonedaCobro,
        medio: this.nombre,
        tipo: tipo as TipoPago,
        estado: estado as EstadoPago,
      },
    }
  }
}

/* ──────────────────────────── ejecución del pago (paso servidor) ──────── */

interface RespuestaPagoPayway {
  status?: string
  status_details?: { error?: { message?: string } | null }
}

/**
 * Ejecuta el pago contra Payway con el token que ya tokenizó el navegador, y
 * firma el evento resultante contra el webhook propio (`/api/webhooks/pagos/payway`)
 * para que lo procese el mismo pipeline que cualquier otro proveedor —nunca
 * escribe en `pagos` directamente, por la misma razón que documenta
 * `app/pago-simulado/actions.ts`—.
 *
 * La llama la Server Action de `/pago-payway/[reservaId]`, nunca el cliente:
 * `PAYWAY_PRIVATE_KEY` no puede viajar al navegador.
 */
export async function ejecutarPagoPayway(p: {
  token: string
  externalId: string
  reservaId: string
  monto: number
  urlSitio: string
}): Promise<{ ok: true } | { error: string }> {
  const privateKey = process.env.PAYWAY_PRIVATE_KEY?.trim()
  if (!privateKey) return { error: 'Falta PAYWAY_PRIVATE_KEY: no se puede ejecutar el cobro.' }

  const cuerpo = {
    site_transaction_id: p.externalId,
    token: p.token,
    payment_method_id: 1, // tarjeta de crédito Visa; el resto de los medios locales quedan para una fase futura
    amount: aCentavos(p.monto),
    currency: 'ARS',
    installments: 1,
  }

  const r = await llamar(`${baseApi()}/payments`, {
    method: 'POST',
    headers: { apikey: privateKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  if ('error' in r) return r

  const pago = r.datos as RespuestaPagoPayway
  const estadoPayway = traducirEstado(String(pago.status ?? ''))
  if (!estadoPayway) {
    return { error: pago.status_details?.error?.message ?? 'Payway no aprobó el pago.' }
  }

  return await avisarResultado({
    externalId: p.externalId,
    reservaId: p.reservaId,
    monto: p.monto,
    estado: estadoPayway,
    urlSitio: p.urlSitio,
  })
}

/** Arma y firma el evento interno, y lo postea contra el webhook propio. */
async function avisarResultado(p: {
  externalId: string
  reservaId: string
  monto: number
  estado: EstadoPago
  urlSitio: string
}): Promise<{ ok: true } | { error: string }> {
  const cuerpo = JSON.stringify({
    external_id: p.externalId,
    reserva_id: p.reservaId,
    monto: p.monto,
    moneda: 'ARS',
    tipo: 'saldo',
    estado: p.estado,
  })

  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' }
  const secreto = process.env.PAYWAY_INTERNAL_SECRET?.trim()
  if (secreto) {
    const ts = String(Math.floor(Date.now() / 1000))
    cabeceras['x-webhook-timestamp'] = ts
    cabeceras['x-webhook-signature'] = await firmar(secreto, ts, cuerpo)
  }

  const base = p.urlSitio.replace(/\/$/, '')
  const r = await llamar(`${base}/api/webhooks/pagos/payway`, {
    method: 'POST',
    headers: cabeceras,
    body: cuerpo,
  })
  if ('error' in r) return r
  return { ok: true }
}

type Respuesta = { datos: Record<string, unknown> } | { error: string }

/** Mismo patrón que `mercadopago.ts`: nunca lanza, siempre `{ error }` en vez de excepción. */
async function llamar(url: string, init: RequestInit): Promise<Respuesta> {
  const corte = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: corte })
    const texto = await res.text()

    if (!res.ok) {
      await registrarError('pasarela_http_error', {
        proveedor: 'payway',
        estado: res.status,
        url,
        cuerpo: texto.slice(0, 500),
      })
      return { error: `Payway respondió ${res.status}.` }
    }
    return { datos: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    await registrarError('pasarela_sin_respuesta', { proveedor: 'payway', url, motivo, corto: corte.aborted })
    return { error: corte.aborted ? 'Payway no respondió a tiempo.' : 'No se pudo contactar a Payway.' }
  }
}
