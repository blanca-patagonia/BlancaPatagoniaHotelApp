import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ProveedorMercadoPago } from '@/lib/payments/mercadopago'
import { ProveedorStripe, aUnidadMinima, desdeUnidadMinima } from '@/lib/payments/stripe'
import { hmacHex } from '@/lib/integraciones/firma-webhook'
import { proveedoresHabilitados, nombreClave, estaHabilitado } from '@/lib/payments'
import type { ResultadoWebhook } from '@/lib/payments'

/**
 * Adaptadores reales de pasarela, con la red simulada.
 *
 * Qué se prueba acá y por qué no alcanza con el simulador: las dos pasarelas
 * hablan protocolos distintos y **cada una tiene una trampa que no falla, cobra
 * mal o rechaza todo en silencio**:
 *
 *  · Stripe cuenta en centavos. Mandar `145.2` en vez de `14520` cobra un dólar
 *    cuarenta y cinco, y no hay error en ningún lado.
 *  · MercadoPago firma un manifiesto, no el cuerpo. Un HMAC sobre el cuerpo
 *    crudo rechaza todos los eventos y el síntoma es «el hotel dejó de
 *    enterarse de los pagos».
 *  · Las dos mandan eventos que no hablan de cobros. Contestarles 400 hace que
 *    terminen deshabilitando el endpoint.
 */

const SECRETO = 'secreto-de-prueba'
const fetchOriginal = globalThis.fetch

beforeEach(() => {
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'token-mp'
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  process.env.STRIPE_WEBHOOK_SECRET = SECRETO
})

afterEach(() => {
  globalThis.fetch = fetchOriginal
  vi.unstubAllEnvs()
})

/** Reemplaza `fetch` por uno que devuelve lo que se le indique. */
function fetchFalso(respuesta: unknown, ok = true, status = 200) {
  const llamadas: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init })
    return {
      ok,
      status,
      text: async () => JSON.stringify(respuesta),
    } as Response
  }) as unknown as typeof fetch
  return llamadas
}

const URLS = { exito: 'https://h.local/ok', error: 'https://h.local/no', pendiente: 'https://h.local/esperando' }

const PARAMS = {
  reservaId: '11111111-1111-1111-1111-111111111111',
  externalId: 'bp_abc123',
  descripcion: 'Reserva BP-1 · seña',
  tipo: 'senia' as const,
  urls: URLS,
  venceEn: new Date(Date.now() + 48 * 3600 * 1000),
}

/** El evento, cuando el resultado es uno. Falla el test si no lo es. */
function evento(r: ResultadoWebhook) {
  expect(r.tipo, `se esperaba un evento y vino «${r.tipo}»`).toBe('evento')
  return r.tipo === 'evento' ? r.evento : null!
}

/* ─────────────────────────────────────────────────────── Stripe ────────── */

describe('Stripe · la unidad mínima', () => {
  it('convierte a centavos y vuelve', () => {
    expect(aUnidadMinima(145.2, 'USD')).toBe(14520)
    expect(desdeUnidadMinima(14520, 'USD')).toBe(145.2)
  })

  it('no multiplica las monedas sin decimales', () => {
    // ¥1000 son 1000 unidades mínimas, no 100.000.
    expect(aUnidadMinima(1000, 'JPY')).toBe(1000)
    expect(desdeUnidadMinima(1000, 'JPY')).toBe(1000)
  })

  it('redondea al centavo en vez de arrastrar decimales', () => {
    expect(aUnidadMinima(33.333, 'USD')).toBe(3333)
  })

  it('el checkout manda el importe en centavos, no en dólares', async () => {
    const llamadas = fetchFalso({ url: 'https://checkout.stripe.com/x' })
    const r = await new ProveedorStripe().crearCheckout({ ...PARAMS, monto: 145.2, moneda: 'USD' })

    expect(r).toMatchObject({ url: 'https://checkout.stripe.com/x' })
    // El cuerpo va urlencoded: hay que decodificarlo para leer el campo anidado.
    const cuerpo = new URLSearchParams(String(llamadas[0].init.body))
    expect(cuerpo.get('line_items[0][price_data][unit_amount]')).toBe('14520')
    // El error clásico: mandar el importe tal cual, que cobra 100 veces menos.
    expect(cuerpo.get('line_items[0][price_data][unit_amount]')).not.toBe('145.2')
  })

  it('recorta la vigencia al máximo que admite Stripe', async () => {
    // El link del sistema vive 48 h y Stripe no admite más de 24: pasarse hace
    // que rechace la sesión entera con un 400.
    const llamadas = fetchFalso({ url: 'https://checkout.stripe.com/x' })
    await new ProveedorStripe().crearCheckout({ ...PARAMS, monto: 100, moneda: 'USD' })

    const cuerpo = new URLSearchParams(String(llamadas[0].init.body))
    const expira = Number(cuerpo.get('expires_at')) * 1000
    expect(expira - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000 + 1000)
    expect(expira).toBeGreaterThan(Date.now())
  })

  it('un fallo de la pasarela devuelve error, no lanza', async () => {
    // Quien llama tiene que poder anular el pago pendiente que ya escribió.
    fetchFalso({ error: 'no' }, false, 402)
    const r = await new ProveedorStripe().crearCheckout({ ...PARAMS, monto: 100, moneda: 'USD' })
    expect(r).toHaveProperty('error')
  })

  it('sin credencial no llama a nadie y avisa', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const r = await new ProveedorStripe().crearCheckout({ ...PARAMS, monto: 100, moneda: 'USD' })
    expect(r).toMatchObject({ error: expect.stringContaining('STRIPE_SECRET_KEY') })
  })
})

describe('Stripe · webhook', () => {
  /** Arma un pedido firmado como lo hace Stripe. */
  async function pedidoFirmado(cuerpo: unknown, secreto = SECRETO) {
    const texto = JSON.stringify(cuerpo)
    const t = String(Math.floor(Date.now() / 1000))
    const firma = await hmacHex(secreto, `${t}.${texto}`)
    return new Request('https://h.local/api/webhooks/pagos/stripe', {
      method: 'POST',
      body: texto,
      headers: { 'stripe-signature': `t=${t},v1=${firma}` },
    })
  }

  const SESION_PAGADA = {
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: 'bp_abc123',
        currency: 'usd',
        amount_total: 14520,
        payment_status: 'paid',
        metadata: { reserva_id: '11111111-1111-1111-1111-111111111111', tipo: 'senia' },
      },
    },
  }

  it('acepta una firma válida', async () => {
    expect(await new ProveedorStripe().verificarFirma(await pedidoFirmado(SESION_PAGADA))).toBe(true)
  })

  it('rechaza una firma calculada con otro secreto', async () => {
    const req = await pedidoFirmado(SESION_PAGADA, 'otro-secreto')
    expect(await new ProveedorStripe().verificarFirma(req)).toBe(false)
  })

  it('rechaza un evento con timestamp viejo: es el reenvío', async () => {
    const texto = JSON.stringify(SESION_PAGADA)
    const viejo = String(Math.floor(Date.now() / 1000) - 3600)
    const firma = await hmacHex(SECRETO, `${viejo}.${texto}`)
    const req = new Request('https://h.local/', {
      method: 'POST',
      body: texto,
      headers: { 'stripe-signature': `t=${viejo},v1=${firma}` },
    })
    expect(await new ProveedorStripe().verificarFirma(req)).toBe(false)
  })

  it('convierte los centavos de vuelta a dólares', async () => {
    const e = evento(await new ProveedorStripe().parsearWebhook(await pedidoFirmado(SESION_PAGADA)))
    expect(e.monto).toBe(145.2)
    expect(e.moneda).toBe('USD')
    expect(e.estado).toBe('aprobado')
    expect(e.externalId).toBe('bp_abc123')
  })

  /*
    El caso que saldaría una reserva con plata que no llegó. «Completed» quiere
    decir que el huésped terminó el formulario, no que entró el dinero: con un
    medio diferido queda `unpaid` y se confirma después.
  */
  it('una sesión completada pero SIN pagar queda pendiente, no aprobada', async () => {
    const sinPagar = {
      ...SESION_PAGADA,
      data: { object: { ...SESION_PAGADA.data.object, payment_status: 'unpaid' } },
    }
    const e = evento(await new ProveedorStripe().parsearWebhook(await pedidoFirmado(sinPagar)))
    expect(e.estado).toBe('pendiente')
  })

  it('el pago diferido que después entra sí aprueba', async () => {
    const despues = { ...SESION_PAGADA, type: 'checkout.session.async_payment_succeeded' }
    const e = evento(await new ProveedorStripe().parsearWebhook(await pedidoFirmado(despues)))
    expect(e.estado).toBe('aprobado')
  })

  it('una sesión vencida se registra como rechazada', async () => {
    const vencida = { ...SESION_PAGADA, type: 'checkout.session.expired' }
    const e = evento(await new ProveedorStripe().parsearWebhook(await pedidoFirmado(vencida)))
    expect(e.estado).toBe('rechazado')
  })

  it('un evento que no habla de un cobro se IGNORA, no se rechaza', async () => {
    // Con 400, Stripe acumula fallos y termina deshabilitando el endpoint.
    const otro = { type: 'customer.subscription.updated', data: { object: {} } }
    const r = await new ProveedorStripe().parsearWebhook(await pedidoFirmado(otro))
    expect(r.tipo).toBe('ignorar')
  })

  it('un cobro sin referencia del sistema se ignora', async () => {
    const ajeno = {
      ...SESION_PAGADA,
      data: { object: { ...SESION_PAGADA.data.object, client_reference_id: null, metadata: {} } },
    }
    const r = await new ProveedorStripe().parsearWebhook(await pedidoFirmado(ajeno))
    expect(r.tipo).toBe('ignorar')
  })
})

/* ─────────────────────────────────────────────────── MercadoPago ───────── */

describe('MercadoPago · checkout', () => {
  it('crea la preferencia en pesos y devuelve el init_point', async () => {
    const llamadas = fetchFalso({ id: 'pref-1', init_point: 'https://mp.com/pagar' })
    const r = await new ProveedorMercadoPago().crearCheckout({
      ...PARAMS,
      monto: 145000,
      moneda: 'ARS',
    })

    expect(r).toMatchObject({ url: 'https://mp.com/pagar' })
    const cuerpo = JSON.parse(String(llamadas[0].init.body))
    expect(cuerpo.items[0].unit_price).toBe(145000)
    expect(cuerpo.items[0].currency_id).toBe('ARS')
    // Es lo que ata el evento a `pagos.external_id`.
    expect(cuerpo.external_reference).toBe('bp_abc123')
    expect(cuerpo.metadata.reserva_id).toBe(PARAMS.reservaId)
    // El link tiene que morir solo.
    expect(cuerpo.expires).toBe(true)
    expect(cuerpo.expiration_date_to).toBeTruthy()
  })

  it('manda la clave de idempotencia: reintentar no crea dos preferencias', async () => {
    const llamadas = fetchFalso({ init_point: 'https://mp.com/pagar' })
    await new ProveedorMercadoPago().crearCheckout({ ...PARAMS, monto: 1000, moneda: 'ARS' })
    const headers = llamadas[0].init.headers as Record<string, string>
    expect(headers['X-Idempotency-Key']).toBe('bp_abc123')
  })

  it('sin credencial no llama a nadie y avisa', async () => {
    delete process.env.MERCADOPAGO_ACCESS_TOKEN
    const r = await new ProveedorMercadoPago().crearCheckout({
      ...PARAMS,
      monto: 1000,
      moneda: 'ARS',
    })
    expect(r).toMatchObject({ error: expect.stringContaining('MERCADOPAGO_ACCESS_TOKEN') })
  })
})

describe('MercadoPago · webhook', () => {
  const AVISO = { type: 'payment', data: { id: '999' } }

  /** Arma el pedido con la firma de manifiesto que usa MercadoPago. */
  async function pedidoFirmado(aviso: unknown = AVISO, requestId = 'req-1') {
    const texto = JSON.stringify(aviso)
    const ts = String(Math.floor(Date.now() / 1000))
    const id = String((aviso as { data?: { id?: string } }).data?.id ?? '').toLowerCase()
    const firma = await hmacHex(SECRETO, `id:${id};request-id:${requestId};ts:${ts};`)
    return new Request('https://h.local/api/webhooks/pagos/mercadopago', {
      method: 'POST',
      body: texto,
      headers: { 'x-signature': `ts=${ts},v1=${firma}`, 'x-request-id': requestId },
    })
  }

  it('acepta la firma del manifiesto', async () => {
    // La trampa: NO es un HMAC del cuerpo. Es `id:…;request-id:…;ts:…;`
    expect(await new ProveedorMercadoPago().verificarFirma(await pedidoFirmado())).toBe(true)
  })

  it('rechaza una firma calculada sobre el cuerpo crudo', async () => {
    const texto = JSON.stringify(AVISO)
    const ts = String(Math.floor(Date.now() / 1000))
    const equivocada = await hmacHex(SECRETO, `${ts}.${texto}`)
    const req = new Request('https://h.local/', {
      method: 'POST',
      body: texto,
      headers: { 'x-signature': `ts=${ts},v1=${equivocada}`, 'x-request-id': 'req-1' },
    })
    expect(await new ProveedorMercadoPago().verificarFirma(req)).toBe(false)
  })

  it('rechaza si falta la cabecera de firma', async () => {
    const req = new Request('https://h.local/', { method: 'POST', body: JSON.stringify(AVISO) })
    expect(await new ProveedorMercadoPago().verificarFirma(req)).toBe(false)
  })

  /*
    El aviso de MercadoPago NO trae el importe: sólo un id. El adapter tiene que
    ir a buscar el pago a la API. Es lo que impide que alguien que logre
    falsificar un aviso decida cuánto se cobró.
  */
  it('va a buscar el importe a la API porque el aviso no lo trae', async () => {
    const llamadas = fetchFalso({
      status: 'approved',
      transaction_amount: 145000,
      currency_id: 'ARS',
      external_reference: 'bp_abc123',
      metadata: { reserva_id: PARAMS.reservaId, tipo: 'senia' },
    })

    const e = evento(await new ProveedorMercadoPago().parsearWebhook(await pedidoFirmado()))

    expect(llamadas[0].url).toContain('/v1/payments/999')
    expect(e.monto).toBe(145000)
    expect(e.moneda).toBe('ARS')
    expect(e.estado).toBe('aprobado')
    expect(e.externalId).toBe('bp_abc123')
    expect(e.tipo).toBe('senia')
  })

  it('traduce los estados de MercadoPago a los del dominio', async () => {
    const casos: [string, string][] = [
      ['approved', 'aprobado'],
      ['rejected', 'rechazado'],
      ['cancelled', 'rechazado'],
      ['pending', 'pendiente'],
      ['in_process', 'pendiente'],
      ['refunded', 'reembolsado'],
      ['charged_back', 'reembolsado'],
    ]
    for (const [mp, propio] of casos) {
      fetchFalso({
        status: mp,
        transaction_amount: 1000,
        currency_id: 'ARS',
        external_reference: 'bp_abc123',
        metadata: {},
      })
      const e = evento(await new ProveedorMercadoPago().parsearWebhook(await pedidoFirmado()))
      expect(e.estado, `${mp} no se tradujo bien`).toBe(propio)
    }
  })

  it('un estado desconocido se rechaza en vez de adivinarlo', async () => {
    fetchFalso({
      status: 'algo_nuevo_de_mercadopago',
      transaction_amount: 1000,
      currency_id: 'ARS',
      external_reference: 'bp_abc123',
      metadata: {},
    })
    const r = await new ProveedorMercadoPago().parsearWebhook(await pedidoFirmado())
    expect(r.tipo).toBe('invalido')
  })

  it('un aviso que no es de un pago se ignora', async () => {
    const otro = { type: 'plan', data: { id: '5' } }
    const r = await new ProveedorMercadoPago().parsearWebhook(await pedidoFirmado(otro))
    expect(r.tipo).toBe('ignorar')
  })

  /*
    La distinción que evita perder un cobro. Si la API de MercadoPago falla un
    segundo y se responde 400, MercadoPago descarta el aviso para siempre y ese
    cobro no se entera nunca más.
  */
  it('si la API falla pide REINTENTO, no marca el evento como inválido', async () => {
    fetchFalso({ error: 'internal' }, false, 500)
    const r = await new ProveedorMercadoPago().parsearWebhook(await pedidoFirmado())
    expect(r.tipo).toBe('reintentar')
  })

  it('un pago sin external_reference se ignora: no lo originó el sistema', async () => {
    fetchFalso({
      status: 'approved',
      transaction_amount: 1000,
      currency_id: 'ARS',
      external_reference: null,
      metadata: {},
    })
    const r = await new ProveedorMercadoPago().parsearWebhook(await pedidoFirmado())
    expect(r.tipo).toBe('ignorar')
  })
})

/* ──────────────────────────────────────── selección de proveedor ───────── */

describe('PAGO_PROVIDER · el régimen del ADR 0018', () => {
  it('sin variable, fuera de producción cae al simulador', () => {
    const p = proveedoresHabilitados(undefined)
    expect(p).toHaveLength(1)
    expect(nombreClave(p[0])).toBe('simulado')
    expect(p[0].esReal()).toBe(false)
  })

  it('habilita varias pasarelas a la vez, que es lo que necesita un hotel internacional', () => {
    // Un huésped de afuera paga con Stripe en dólares y uno local con
    // MercadoPago en pesos: obligar a elegir una sola dejaría a la mitad de los
    // huéspedes sin poder pagar.
    const p = proveedoresHabilitados('mercadopago,stripe')
    expect(p.map(nombreClave)).toEqual(['mercadopago', 'stripe'])
  })

  it('tolera espacios y no duplica un nombre repetido', () => {
    const p = proveedoresHabilitados(' stripe , stripe ,mercadopago ')
    expect(p.map(nombreClave)).toEqual(['stripe', 'mercadopago'])
  })

  it('`estaHabilitado` responde por el nombre de configuración', () => {
    expect(estaHabilitado('stripe', 'stripe')).toBe(true)
    expect(estaHabilitado('mercadopago', 'stripe')).toBe(false)
    expect(estaHabilitado('simulado', 'simulado')).toBe(true)
  })

  it('las dos pasarelas reales se declaran reales', () => {
    expect(proveedoresHabilitados('mercadopago')[0].esReal()).toBe(true)
    expect(proveedoresHabilitados('stripe')[0].esReal()).toBe(true)
  })

  it('ninguna pasarela promete verificar tarjetas de garantía', () => {
    // Cobrar y preautorizar son cosas distintas; declararlo evita que la
    // pantalla ofrezca una certeza que nadie comprobó (ADR 0025).
    for (const nombre of ['mercadopago', 'stripe', 'simulado']) {
      expect(proveedoresHabilitados(nombre)[0].capacidades().verificaTarjeta).toBe(false)
    }
  })
})
