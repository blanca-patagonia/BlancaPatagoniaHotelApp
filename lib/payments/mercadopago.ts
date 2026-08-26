import 'server-only'

/**
 * MercadoPago — Checkout Pro.
 *
 * Qué cubre y por qué está.
 *
 * Es la mitad local del catálogo: pesos argentinos, tarjeta de crédito con
 * cuotas, débito, dinero en cuenta de MercadoPago y **efectivo en Rapipago y
 * Pago Fácil**. Ese último medio es el que ninguna pasarela internacional
 * ofrece y el que un huésped argentino sin tarjeta necesita.
 *
 * Se habla por HTTP y no por el SDK a propósito: el SDK oficial arrastra
 * dependencias y un ciclo de vida propio para tres llamadas que son un `fetch`.
 * Menos superficie que auditar y una dependencia menos que actualizar.
 *
 * ⚠️ LO QUE HAY QUE SABER ANTES DE TOCAR ESTO:
 *
 * 1. **El webhook de MercadoPago NO trae el importe.** Manda `{"data":{"id":…}}`
 *    y nada más. Hay que ir a buscar el pago a la API para saber cuánto, en qué
 *    moneda y con qué estado. Confiar en el cuerpo del webhook para el monto es
 *    imposible acá, y eso es bueno: obliga a que el importe salga siempre de la
 *    fuente autoritativa.
 * 2. **La firma se calcula sobre un manifiesto, no sobre el cuerpo.** Es
 *    `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — distinto de Stripe y
 *    distinto del esquema propio. Un HMAC sobre el cuerpo crudo rechaza todos
 *    los eventos, y el síntoma es «el hotel dejó de enterarse de los pagos».
 * 3. **Un mismo link puede generar varios intentos**, todos con el mismo
 *    `external_reference`. El rechazado y el aprobado llegan por separado; la
 *    regla que ordena eso es `puedeAvanzarEstadoPago` (lib/domain/pagos.ts).
 */

import { hmacHex, comparacionConstante, timestampVigente } from '@/lib/integraciones/firma-webhook'
import type { MedioPago, TipoPago, EstadoPago } from '@/lib/domain/pagos'
import { TIPOS_PAGO } from '@/lib/domain/pagos'
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

const API = 'https://api.mercadopago.com'

/**
 * Corte de las llamadas salientes.
 *
 * Diez segundos. Del otro lado hay alguien esperando para pagar: si la pasarela
 * no contesta en ese plazo, mostrarle un error y dejarlo reintentar es mejor
 * que una pantalla colgada. Sin timeout, un `fetch` puede quedarse pegado hasta
 * el límite del runtime y consumir la request entera.
 */
const TIMEOUT_MS = 10_000

/** Estados de MercadoPago → estados del dominio. */
function traducirEstado(estado: string): EstadoPago | null {
  switch (estado) {
    case 'approved':
      return 'aprobado'
    case 'rejected':
    case 'cancelled':
      return 'rechazado'
    case 'pending':
    case 'in_process':
    case 'in_mediation':
    case 'authorized':
      return 'pendiente'
    case 'refunded':
    case 'charged_back':
      return 'reembolsado'
    default:
      // Un estado que MercadoPago agregue mañana no se adivina. Devolver `null`
      // hace que el webhook responda 400 y quede en el log, que es lo correcto:
      // inventar una traducción sobre dinero es peor que rechazar el evento.
      return null
  }
}

interface PagoMP {
  status?: string
  transaction_amount?: number
  currency_id?: string
  external_reference?: string
  metadata?: Record<string, unknown>
}

export class ProveedorMercadoPago implements PaymentProvider {
  readonly nombre: MedioPago = 'mercadopago'

  esReal(): boolean {
    return true
  }

  capacidades(): CapacidadesPago {
    return {
      // Checkout Pro cobra, pero no preautoriza y devuelve un token reutilizable
      // para la garantía. Eso pide Checkout API con tokenización, que exige
      // certificación PCI aparte. Se declara en `false` para no prometerlo.
      verificaTarjeta: false,
      cobraEnLinea: true,
      // La cuenta de MercadoPago Argentina liquida en pesos. Ofrecer USD acá
      // haría que la pasarela convierta a su propio tipo de cambio, y entonces
      // `pagos.cotizacion` diría una cosa y el resumen del huésped otra.
      monedas: ['ARS'],
    }
  }

  /**
   * Checkout Pro no preautoriza tarjetas para garantía.
   *
   * Es un `noSoportado`, no un rechazo: la tarjeta del huésped puede estar
   * perfecta. Ver ADR 0025.
   */
  async verificarTarjeta(datos: DatosTarjeta): Promise<ResultadoVerificacionTarjeta> {
    const digitos = datos.numero.replace(/\D/g, '')
    return {
      ok: false,
      noSoportado: true,
      ultimos4: digitos.length >= 4 ? digitos.slice(-4) : undefined,
      vencimiento: datos.vencimiento,
      detalle:
        'Checkout Pro cobra pero no preautoriza tarjetas de garantía. Requiere Checkout API con tokenización.',
    }
  }

  async crearCheckout(p: CheckoutParams): Promise<ResultadoCheckout> {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim()
    if (!token) {
      return { error: 'Falta MERCADOPAGO_ACCESS_TOKEN: no se puede crear el cobro.' }
    }

    const cuerpo: Record<string, unknown> = {
      items: [
        {
          id: p.externalId,
          title: p.descripcion,
          quantity: 1,
          unit_price: p.monto,
          currency_id: p.moneda,
        },
      ],
      // Es lo que vuelve en el pago y lo que ata el evento a `pagos.external_id`.
      external_reference: p.externalId,
      metadata: { reserva_id: p.reservaId, tipo: p.tipo },
      back_urls: {
        success: p.urls.exito,
        failure: p.urls.error,
        pending: p.urls.pendiente,
      },
      // El link muere solo. Uno eterno cobra una seña de algo ya cancelado y
      // revendido, y devolver esa plata es un trámite manual con la pasarela.
      expires: true,
      expiration_date_to: p.venceEn.toISOString(),
      notification_url: urlDeNotificacion(),
    }

    if (p.emailComprador) cuerpo.payer = { email: p.emailComprador }

    // `auto_return` exige que la URL de éxito sea absoluta y accesible desde
    // afuera. Con `localhost` MercadoPago rechaza la preferencia entera, así que
    // en desarrollo se omite y el huésped vuelve con el botón de la pasarela.
    if (p.urls.exito.startsWith('https://')) cuerpo.auto_return = 'approved'

    const r = await llamar(`${API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Reintentar la creación no genera dos preferencias por el mismo pago.
        'X-Idempotency-Key': p.externalId,
      },
      body: JSON.stringify(cuerpo),
    })

    if ('error' in r) return r

    const url = typeof r.datos.init_point === 'string' ? r.datos.init_point : null
    if (!url) {
      return { error: 'MercadoPago no devolvió el enlace de pago (init_point).' }
    }
    return { url, externalId: p.externalId }
  }

  /**
   * Verifica la firma `x-signature` de MercadoPago.
   *
   * Manifiesto: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
   *
   * Ese `id` es el del **pago**, no el del evento, y va en minúsculas cuando es
   * alfanumérico. Es el detalle que más se equivoca al implementar esto.
   */
  async verificarFirma(req: Request): Promise<boolean> {
    const secreto = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim()
    if (!secreto) {
      // Fail-closed en producción: sin secreto, cualquiera podría registrar
      // pagos aprobados que nadie hizo.
      if (process.env.NODE_ENV === 'production') {
        console.error('[webhook mercadopago] falta MERCADOPAGO_WEBHOOK_SECRET')
        return false
      }
      return true
    }

    const firma = req.headers.get('x-signature')
    const requestId = req.headers.get('x-request-id') ?? ''
    if (!firma) {
      console.error('[webhook mercadopago] falta la cabecera x-signature')
      return false
    }

    // `ts=1704908010,v1=abc…`
    const partes = new Map(
      firma.split(',').map((p) => {
        const [k, ...resto] = p.split('=')
        return [k.trim(), resto.join('=').trim()]
      }),
    )
    const ts = partes.get('ts')
    const recibida = partes.get('v1')
    if (!ts || !recibida) {
      console.error('[webhook mercadopago] x-signature sin ts o v1')
      return false
    }

    if (!timestampVigente(ts, Math.floor(Date.now() / 1000))) {
      // Sin esto, capturar un evento válido una vez alcanza para reenviarlo
      // para siempre.
      console.error('[webhook mercadopago] timestamp fuera de la ventana de tolerancia')
      return false
    }

    const idPago = await idDelPago(req)
    if (!idPago) {
      console.error('[webhook mercadopago] el cuerpo no trae data.id')
      return false
    }

    const manifiesto = `id:${idPago};request-id:${requestId};ts:${ts};`
    const esperada = await hmacHex(secreto, manifiesto)
    if (!comparacionConstante(esperada, recibida)) {
      console.error('[webhook mercadopago] la firma no coincide')
      return false
    }
    return true
  }

  /**
   * Traduce el aviso de MercadoPago a un evento del dominio.
   *
   * El aviso solo trae un id: el importe, la moneda y el estado se traen de la
   * API. Es la única fuente confiable —el cuerpo del webhook no los tiene— y
   * además evita que alguien que logre falsificar un aviso decida el monto.
   */
  async parsearWebhook(req: Request): Promise<ResultadoWebhook> {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim()
    if (!token) {
      // Falta configuración, no viene mal el aviso. Que la pasarela reintente
      // da tiempo a reponer la variable sin perder el cobro.
      return { tipo: 'reintentar', motivo: 'falta MERCADOPAGO_ACCESS_TOKEN para consultar el pago' }
    }

    let aviso: Record<string, unknown>
    try {
      aviso = await req.json()
    } catch {
      return { tipo: 'invalido', motivo: 'el cuerpo no es JSON' }
    }

    // MercadoPago avisa de varias cosas (`payment`, `plan`, `subscription`…).
    // Solo interesan los pagos; el resto se ignora sin ruido.
    const tipoAviso = String(aviso.type ?? aviso.topic ?? '')
    if (tipoAviso && tipoAviso !== 'payment') {
      return { tipo: 'ignorar', motivo: `aviso de tipo «${tipoAviso}», no es un pago` }
    }

    const datos = aviso.data as Record<string, unknown> | undefined
    const idPago = String(datos?.id ?? '')
    if (!idPago) return { tipo: 'invalido', motivo: 'el aviso no trae data.id' }

    const r = await llamar(`${API}/v1/payments/${encodeURIComponent(idPago)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if ('error' in r) {
      // No es «inválido»: el aviso puede estar perfecto y ser la API la que
      // falló. Con 400 MercadoPago lo descarta para siempre y ese cobro no se
      // entera nunca más; con 500 lo reintenta, que es lo que corresponde ante
      // un problema que probablemente dure segundos.
      return { tipo: 'reintentar', motivo: `no se pudo leer el pago ${idPago}: ${r.error}` }
    }

    const pago = r.datos as PagoMP
    const externalId = String(pago.external_reference ?? '')
    const monto = Number(pago.transaction_amount ?? 0)
    const estado = traducirEstado(String(pago.status ?? ''))
    const moneda = String(pago.currency_id ?? '')

    // Un pago sin `external_reference` no lo originó este sistema (lo cobraron
    // desde el panel de MercadoPago). Se ignora en vez de fallar: es legítimo y
    // no hay reserva a la cual imputarlo.
    if (!externalId) {
      return { tipo: 'ignorar', motivo: 'el pago no tiene external_reference del sistema' }
    }
    if (!(monto > 0)) return { tipo: 'invalido', motivo: 'el importe no es positivo' }
    if (!estado) {
      return { tipo: 'invalido', motivo: `estado desconocido de MercadoPago: ${String(pago.status)}` }
    }
    if (!esMonedaDeCobro(moneda)) {
      return { tipo: 'invalido', motivo: `moneda desconocida: ${moneda}` }
    }

    const tipoPago = String(pago.metadata?.tipo ?? 'saldo')

    return {
      tipo: 'evento',
      evento: {
        externalId,
        reservaId: String(pago.metadata?.reserva_id ?? ''),
        monto,
        moneda: moneda as MonedaCobro,
        medio: this.nombre,
        tipo: TIPOS_PAGO.includes(tipoPago as TipoPago) ? (tipoPago as TipoPago) : 'saldo',
        estado,
      },
    }
  }
}

/** El `data.id` del aviso, leído sin consumir el request original. */
async function idDelPago(req: Request): Promise<string | null> {
  try {
    const cuerpo = (await req.clone().json()) as Record<string, unknown>
    const datos = cuerpo.data as Record<string, unknown> | undefined
    const id = datos?.id
    if (id === undefined || id === null) return null
    // MercadoPago pide el id en minúsculas cuando es alfanumérico.
    return String(id).toLowerCase()
  } catch {
    return null
  }
}

/**
 * A dónde le avisa MercadoPago que hubo un pago.
 *
 * Se manda explícita en cada preferencia en vez de configurarla una vez en el
 * panel de MercadoPago porque así el entorno de pruebas y el de producción
 * apuntan cada uno al suyo sin que nadie tenga que acordarse de cambiarlo.
 */
function urlDeNotificacion(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}/api/webhooks/pagos/mercadopago`
}

type Respuesta = { datos: Record<string, unknown> } | { error: string }

/**
 * Llamada HTTP con timeout y errores traducidos a algo que se pueda mostrar.
 *
 * Nunca lanza: devuelve `{ error }`. Quien llama tiene que poder deshacer la
 * fila `pendiente` que ya escribió, y una excepción atravesando la Server Action
 * dejaría un pago fantasma esperando un webhook que no va a llegar.
 */
async function llamar(url: string, init: RequestInit): Promise<Respuesta> {
  const corte = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: corte })
    const texto = await res.text()

    if (!res.ok) {
      // El cuerpo del error de MercadoPago trae el motivo real. Va al log del
      // servidor; al huésped se le muestra algo genérico.
      console.error(`[mercadopago] ${res.status} en ${url}: ${texto.slice(0, 500)}`)
      return { error: `MercadoPago respondió ${res.status}.` }
    }

    return { datos: JSON.parse(texto) as Record<string, unknown> }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error(`[mercadopago] falló la llamada a ${url}: ${motivo}`)
    return {
      error:
        corte.aborted
          ? 'MercadoPago no respondió a tiempo.'
          : 'No se pudo contactar a MercadoPago.',
    }
  }
}
