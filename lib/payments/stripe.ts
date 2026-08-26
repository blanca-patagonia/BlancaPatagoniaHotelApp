import 'server-only'

/**
 * Stripe — Checkout Sessions.
 *
 * Qué cubre y por qué está.
 *
 * Es la mitad internacional del catálogo, y la razón por la que el sistema tiene
 * dos pasarelas en vez de una. El hotel recibe huéspedes del exterior: una
 * tarjeta emitida en Alemania o en Estados Unidos pasa por Stripe sin fricción y
 * **se cobra directamente en dólares**, sin que ninguna conversión se meta entre
 * el precio publicado y lo que llega al resumen del huésped. MercadoPago cubre
 * lo local (pesos, cuotas, Rapipago) y no cubre bien esto.
 *
 * Se habla por HTTP y no por el SDK: son dos llamadas y un HMAC.
 *
 * ⚠️ LO QUE HAY QUE SABER ANTES DE TOCAR ESTO:
 *
 * 1. **Los importes van en la unidad mínima de la moneda.** USD 145,20 se manda
 *    como `14520`. Mandar `145.2` cobra un dólar cuarenta y cinco. Es el error
 *    clásico de esta API y no falla: cobra mal.
 * 2. **`expires_at` admite como máximo 24 horas.** El link del sistema vive 48
 *    (`HORAS_VIGENCIA_LINK`), así que acá se recorta. Pasarse hace que Stripe
 *    rechace la sesión entera con un 400.
 * 3. **Stripe manda decenas de tipos de evento.** Solo interesan cuatro; el
 *    resto se responde con 200 y se ignora. Contestarles 400 acumula fallos y
 *    Stripe **termina deshabilitando el endpoint**, con lo cual el hotel deja de
 *    enterarse también de los cobros buenos.
 * 4. **El cuerpo del webhook sí trae el importe**, a diferencia de MercadoPago.
 *    Igual se contrasta contra lo que el sistema pidió cobrar, en el webhook.
 */

import { hmacHex, comparacionConstante, timestampVigente } from '@/lib/integraciones/firma-webhook'
import { TIPOS_PAGO, type MedioPago, type TipoPago, type EstadoPago } from '@/lib/domain/pagos'
import type { MonedaCobro } from '@/lib/domain/cobro'
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

const API = 'https://api.stripe.com/v1'

/** Ver el comentario de `TIMEOUT_MS` en `mercadopago.ts`: mismo criterio. */
const TIMEOUT_MS = 10_000

/**
 * Techo de vigencia que admite Stripe para una sesión de checkout.
 *
 * No es una elección: la API rechaza cualquier `expires_at` a más de 24 horas.
 */
const MAX_VIGENCIA_MS = 24 * 60 * 60 * 1000

/** Y un piso, también impuesto por Stripe. */
const MIN_VIGENCIA_MS = 30 * 60 * 1000

/**
 * Monedas sin decimales.
 *
 * En estas, la «unidad mínima» ES la unidad: ¥1000 se manda como `1000`, no como
 * `100000`. Ninguna está hoy en el catálogo del hotel, pero la lista evita que
 * agregar una mañana multiplique los importes por cien.
 */
const SIN_DECIMALES = new Set(['JPY', 'KRW', 'CLP', 'VND', 'ISK'])

/** Pasa un importe a la unidad mínima que espera Stripe. */
export function aUnidadMinima(monto: number, moneda: string): number {
  return SIN_DECIMALES.has(moneda.toUpperCase())
    ? Math.round(monto)
    : Math.round(monto * 100)
}

/** Y vuelve. Es la inversa exacta de `aUnidadMinima`. */
export function desdeUnidadMinima(monto: number, moneda: string): number {
  return SIN_DECIMALES.has(moneda.toUpperCase()) ? monto : monto / 100
}

export class ProveedorStripe implements PaymentProvider {
  readonly nombre: MedioPago = 'stripe'

  esReal(): boolean {
    return true
  }

  capacidades(): CapacidadesPago {
    return {
      // Cobrar sí; preautorizar una tarjeta de garantía y guardar el token pide
      // SetupIntents, que es otro flujo. Se declara en `false` hasta que exista.
      verificaTarjeta: false,
      cobraEnLinea: true,
      // USD es lo que importa acá: es la moneda base del sistema y la del
      // huésped del exterior. Las otras dos quedan disponibles porque Stripe las
      // liquida sin conversión intermedia.
      monedas: ['USD', 'EUR', 'BRL'],
    }
  }

  /**
   * Checkout Sessions no preautoriza para garantía.
   *
   * Es un `noSoportado`, no un rechazo: la tarjeta puede estar perfecta (ADR 0025).
   */
  async verificarTarjeta(datos: DatosTarjeta): Promise<ResultadoVerificacionTarjeta> {
    const digitos = datos.numero.replace(/\D/g, '')
    return {
      ok: false,
      noSoportado: true,
      ultimos4: digitos.length >= 4 ? digitos.slice(-4) : undefined,
      vencimiento: datos.vencimiento,
      detalle:
        'Checkout Sessions cobra pero no preautoriza tarjetas de garantía. Requiere SetupIntents.',
    }
  }

  async crearCheckout(p: CheckoutParams): Promise<ResultadoCheckout> {
    const clave = process.env.STRIPE_SECRET_KEY?.trim()
    if (!clave) return { error: 'Falta STRIPE_SECRET_KEY: no se puede crear el cobro.' }

    // Recorte de la vigencia al rango que admite Stripe (ver constantes).
    const ahora = Date.now()
    const pedido = p.venceEn.getTime()
    const vence = Math.min(Math.max(pedido, ahora + MIN_VIGENCIA_MS), ahora + MAX_VIGENCIA_MS)

    const campos: Record<string, string> = {
      mode: 'payment',
      success_url: p.urls.exito,
      cancel_url: p.urls.error,
      // Lo que ata el evento a `pagos.external_id`.
      client_reference_id: p.externalId,
      'metadata[external_id]': p.externalId,
      'metadata[reserva_id]': p.reservaId,
      'metadata[tipo]': p.tipo,
      expires_at: String(Math.floor(vence / 1000)),
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': p.moneda.toLowerCase(),
      'line_items[0][price_data][product_data][name]': p.descripcion,
      'line_items[0][price_data][unit_amount]': String(aUnidadMinima(p.monto, p.moneda)),
    }

    if (p.emailComprador) campos.customer_email = p.emailComprador

    const r = await llamar(`${API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clave}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Reintentar la creación no genera dos sesiones por el mismo pago.
        'Idempotency-Key': p.externalId,
      },
      body: new URLSearchParams(campos).toString(),
    })

    if ('error' in r) return r

    const url = typeof r.datos.url === 'string' ? r.datos.url : null
    if (!url) return { error: 'Stripe no devolvió el enlace de pago.' }
    return { url, externalId: p.externalId }
  }

  /**
   * Verifica la cabecera `Stripe-Signature`.
   *
   * Esquema: `t=<unix>,v1=<hmac>` donde el HMAC se calcula sobre
   * `"<t>.<cuerpo crudo>"`. Es el mismo que usa el esquema propio del proyecto,
   * así que se reutiliza `hmacHex`.
   */
  async verificarFirma(req: Request): Promise<boolean> {
    const secreto = process.env.STRIPE_WEBHOOK_SECRET?.trim()
    if (!secreto) {
      // Fail-closed en producción: sin secreto, cualquiera podría registrar
      // pagos aprobados que nadie hizo.
      if (process.env.NODE_ENV === 'production') {
        console.error('[webhook stripe] falta STRIPE_WEBHOOK_SECRET')
        return false
      }
      return true
    }

    const cabecera = req.headers.get('stripe-signature')
    if (!cabecera) {
      console.error('[webhook stripe] falta la cabecera stripe-signature')
      return false
    }

    let t: string | null = null
    // Stripe puede mandar varias `v1` durante una rotación de secreto: vale con
    // que **alguna** coincida, por eso se juntan todas en vez de tomar la primera.
    const firmas: string[] = []
    for (const parte of cabecera.split(',')) {
      const [k, ...resto] = parte.split('=')
      const v = resto.join('=').trim()
      if (k.trim() === 't') t = v
      if (k.trim() === 'v1') firmas.push(v)
    }

    if (!t || firmas.length === 0) {
      console.error('[webhook stripe] stripe-signature sin t o v1')
      return false
    }

    if (!timestampVigente(t, Math.floor(Date.now() / 1000))) {
      // Sin esto, capturar un evento válido una vez alcanza para reenviarlo
      // para siempre.
      console.error('[webhook stripe] timestamp fuera de la ventana de tolerancia')
      return false
    }

    // El cuerpo tiene que leerse CRUDO: parsearlo y volver a serializarlo cambia
    // espacios y orden de claves, y la firma deja de coincidir.
    const cuerpo = await req.text()
    const esperada = await hmacHex(secreto, `${t}.${cuerpo}`)

    if (!firmas.some((f) => comparacionConstante(esperada, f))) {
      console.error('[webhook stripe] la firma no coincide con el cuerpo recibido')
      return false
    }
    return true
  }

  async parsearWebhook(req: Request): Promise<ResultadoWebhook> {
    let evento: Record<string, unknown>
    try {
      evento = await req.json()
    } catch {
      return { tipo: 'invalido', motivo: 'el cuerpo no es JSON' }
    }

    const tipoEvento = String(evento.type ?? '')
    const estado = estadoSegunEvento(tipoEvento)
    if (!estado) {
      return { tipo: 'ignorar', motivo: `evento «${tipoEvento}», no habla de un cobro` }
    }

    const datos = evento.data as Record<string, unknown> | undefined
    const sesion = datos?.object as Record<string, unknown> | undefined
    if (!sesion) return { tipo: 'invalido', motivo: 'el evento no trae data.object' }

    const metadata = (sesion.metadata ?? {}) as Record<string, unknown>
    const externalId = String(sesion.client_reference_id ?? metadata.external_id ?? '')
    if (!externalId) {
      // Un cobro que este sistema no originó (alguien lo hizo desde el panel de
      // Stripe). Es legítimo y no hay reserva a la cual imputarlo.
      return { tipo: 'ignorar', motivo: 'el cobro no tiene client_reference_id del sistema' }
    }

    const moneda = String(sesion.currency ?? '').toUpperCase()
    if (!esMonedaDeCobro(moneda)) {
      return { tipo: 'invalido', motivo: `moneda desconocida: ${moneda}` }
    }

    const bruto = Number(sesion.amount_total ?? 0)
    const monto = desdeUnidadMinima(bruto, moneda)
    if (!(monto > 0)) return { tipo: 'invalido', motivo: 'el importe no es positivo' }

    /*
      Una sesión completada puede NO estar cobrada todavía.

      `checkout.session.completed` significa «el huésped terminó el formulario»,
      no «entró la plata»: con un medio diferido, `payment_status` queda en
      `unpaid` y el cobro se confirma después con
      `checkout.session.async_payment_succeeded`. Tratar ese caso como aprobado
      saldaría la reserva con plata que todavía no llegó —y que puede no llegar.
    */
    let estadoFinal: EstadoPago = estado
    if (tipoEvento === 'checkout.session.completed') {
      const pagada = String(sesion.payment_status ?? '')
      estadoFinal = pagada === 'paid' || pagada === 'no_payment_required' ? 'aprobado' : 'pendiente'
    }

    const tipoPago = String(metadata.tipo ?? 'saldo')

    return {
      tipo: 'evento',
      evento: {
        externalId,
        reservaId: String(metadata.reserva_id ?? ''),
        monto,
        moneda: moneda as MonedaCobro,
        medio: this.nombre,
        tipo: TIPOS_PAGO.includes(tipoPago as TipoPago) ? (tipoPago as TipoPago) : 'saldo',
        estado: estadoFinal,
      },
    }
  }
}

/**
 * Qué estado del dominio implica cada evento de Stripe.
 *
 * `null` significa «este evento no habla de un cobro nuestro» y se responde 200.
 * La lista es corta a propósito: Stripe manda decenas de tipos y agregar los que
 * no se entienden es peor que ignorarlos.
 */
function estadoSegunEvento(tipo: string): EstadoPago | null {
  switch (tipo) {
    case 'checkout.session.completed':
      // El estado real se decide con `payment_status`; ver el comentario arriba.
      return 'aprobado'
    case 'checkout.session.async_payment_succeeded':
      return 'aprobado'
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      return 'rechazado'
    default:
      return null
  }
}

type Respuesta = { datos: Record<string, unknown> } | { error: string }

/** Ver `llamar` en `mercadopago.ts`: mismo contrato, nunca lanza. */
async function llamar(url: string, init: RequestInit): Promise<Respuesta> {
  const corte = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: corte })
    const texto = await res.text()

    if (!res.ok) {
      // El error de Stripe trae el motivo real. Va al log del servidor; al
      // huésped se le muestra algo genérico.
      console.error(`[stripe] ${res.status} en ${url}: ${texto.slice(0, 500)}`)
      return { error: `Stripe respondió ${res.status}.` }
    }

    return { datos: JSON.parse(texto) as Record<string, unknown> }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error(`[stripe] falló la llamada a ${url}: ${motivo}`)
    return {
      error: corte.aborted ? 'Stripe no respondió a tiempo.' : 'No se pudo contactar a Stripe.',
    }
  }
}
