import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ResultadoWebhook, WebhookEvent } from '@/lib/payments'

/**
 * Tests del webhook de pagos.
 *
 * Por qué acá la base va falseada, a diferencia del resto de los tests de
 * integración: lo que hay que verificar es **qué pasa cuando la base falla**, y
 * eso no se puede provocar contra una Postgres sana. Sin poder forzar el error,
 * el camino más importante del webhook queda sin probar.
 *
 * Lo que está en juego: para una pasarela de pagos, un `200` significa
 * «entregado, no reintentes». Si el pago se registra pero la reserva no se marca
 * como pagada y de todos modos se responde `ok`, queda plata cobrada con la
 * reserva sin saldar, la pasarela no reintenta nunca, y como la fila de `pagos`
 * ya existe con su `external_id` único, un reenvío manual tampoco lo arregla.
 */

interface Op {
  tabla: string
  verbo: 'select' | 'insert' | 'update' | 'delete'
  /** `true` cuando la consulta pidió una sola fila (`single`/`maybeSingle`). */
  singular: boolean
}

interface Resultado {
  data?: unknown
  error?: { message: string; code?: string } | null
}

/** Operaciones que registró el cliente falso, en orden. */
let ejecutadas: Op[] = []
/** Respuesta por `tabla:verbo` (`:one` cuando es singular). */
let respuestas: Record<string, Resultado> = {}

/**
 * Cliente de Supabase falseado.
 *
 * El builder de PostgREST es *thenable* y encadenable: acumula la operación y la
 * resuelve recién en el `await`. Se imita eso mismo, que es justo lo que hace
 * que el código de producción pueda escribirse encadenado.
 *
 * ⚠️ Distingue **lectura singular de lista**, y es imprescindible: el handler
 * hace dos `select` sobre `pagos` con propósitos opuestos —buscar la fila del
 * cobro (una) y sumar los pagos de la reserva (varias)—. Sin la distinción, el
 * falso le devolvería un array a la búsqueda de una fila y el test pasaría
 * probando algo que no ocurre.
 */
function clienteFalso() {
  return {
    from(tabla: string) {
      const op: Op = { tabla, verbo: 'select', singular: false }
      const builder = {
        insert() {
          op.verbo = 'insert'
          return builder
        },
        update() {
          op.verbo = 'update'
          return builder
        },
        select() {
          if (op.verbo === 'select') op.verbo = 'select'
          return builder
        },
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle() {
          op.singular = true
          return builder
        },
        single() {
          op.singular = true
          return builder
        },
        then(resolver: (r: Resultado) => unknown, rechazar?: (e: unknown) => unknown) {
          ejecutadas.push({ ...op })
          const clave = `${op.tabla}:${op.verbo}${op.singular ? ':one' : ''}`
          const r = respuestas[clave] ?? { data: null, error: null }
          return Promise.resolve(r).then(resolver, rechazar)
        },
      }
      return builder
    },
  }
}

/** Lo que devuelve el proveedor falso en cada corrida. */
let lectura: ResultadoWebhook
/** Si la firma valida. */
let firmaValida = true

vi.mock('@/lib/supabase/admin', () => ({ crearClienteAdmin: () => clienteFalso() }))
vi.mock('@/lib/payments', () => ({
  obtenerProveedor: () => ({
    nombre: 'generico',
    esReal: () => true,
    capacidades: () => ({ verificaTarjeta: false, cobraEnLinea: true, monedas: ['USD'] }),
    crearCheckout: async () => ({ url: '', externalId: '' }),
    verificarFirma: async () => firmaValida,
    parsearWebhook: async () => lectura,
    verificarTarjeta: async () => ({ ok: false, noSoportado: true }),
  }),
}))
// El límite solo se consulta cuando la firma falla; `headers()` no existe fuera
// de una petición de Next, así que se falsea.
vi.mock('@/lib/limites', () => ({ permitirIntento: async () => true }))
vi.mock('@/lib/divisas/servicio', () => ({ cotizacionVigente: async () => null }))

/** Llama al handler con un cuerpo cualquiera: el proveedor está falseado. */
async function llamar() {
  const { POST } = await import('@/app/api/webhooks/pagos/[proveedor]/route')
  const req = new Request('http://local/api/webhooks/pagos/generico', {
    method: 'POST',
    body: '{}',
  })
  return POST(req, { params: Promise.resolve({ proveedor: 'generico' }) })
}

/** El evento base, con lo que se le quiera cambiar. */
function eventoCon(cambios: Partial<WebhookEvent> = {}): ResultadoWebhook {
  return {
    tipo: 'evento',
    evento: {
      externalId: 'ext-1',
      reservaId: '11111111-1111-1111-1111-111111111111',
      monto: 100,
      moneda: 'USD',
      medio: 'stripe',
      tipo: 'saldo',
      estado: 'aprobado',
      ...cambios,
    },
  }
}

/** El pago pendiente que el sistema escribió al crear el link. */
function cobroPendiente(monto = 100) {
  respuestas['pagos:select:one'] = {
    data: {
      id: 'pago-1',
      estado: 'pendiente',
      monto,
      moneda: 'USD',
      monto_cobrado: monto,
      cotizacion: 1,
      reserva_id: '11111111-1111-1111-1111-111111111111',
    },
    error: null,
  }
}

/** Una reserva `confirmada` de 100 con un pago aprobado de 100: queda saldada. */
function reservaSaldada() {
  respuestas['reservas:select:one'] = { data: { estado: 'confirmada', total: 100 }, error: null }
  respuestas['pagos:select'] = {
    data: [{ tipo: 'saldo', monto: 100, estado: 'aprobado' }],
    error: null,
  }
  respuestas['consumos:select'] = { data: [], error: null }
}

const hizo = (tabla: string, verbo: Op['verbo']) =>
  ejecutadas.some((o) => o.tabla === tabla && o.verbo === verbo)

describe('webhook de pagos · fallar cerrado', () => {
  beforeEach(() => {
    ejecutadas = []
    respuestas = {}
    firmaValida = true
    lectura = eventoCon()
  })

  it('confirma el cobro, marca la reserva pagada y responde ok', async () => {
    cobroPendiente()
    reservaSaldada()
    const res = await llamar()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(hizo('pagos', 'update')).toBe(true)
    expect(hizo('reservas', 'update')).toBe(true)
  })

  it('si no se puede leer el pago previo responde 500 y no toca nada', async () => {
    respuestas['pagos:select:one'] = { error: { message: 'sin conexión' } }
    const res = await llamar()
    expect(res.status).toBe(500)
    expect(hizo('reservas', 'update')).toBe(false)
  })

  it('si falla la transición del pago responde 500: la pasarela tiene que reintentar', async () => {
    cobroPendiente()
    reservaSaldada()
    respuestas['pagos:update'] = { error: { message: 'la base rechazó' } }
    const res = await llamar()
    expect(res.status).toBe(500)
    // No se sigue a saldar la reserva con el pago sin confirmar.
    expect(hizo('reservas', 'update')).toBe(false)
  })

  it('si falla marcar la reserva como pagada responde 500 y NO ok', async () => {
    // El fallo silencioso original: el pago quedaba registrado, la reserva no se
    // marcaba y la pasarela recibía un `ok` que le decía «no reintentes».
    cobroPendiente()
    reservaSaldada()
    respuestas['reservas:update'] = { error: { message: 'no se pudo actualizar' } }
    const res = await llamar()
    expect(res.status).toBe(500)
  })

  it('si no se pueden leer los consumos no salda: podría estar cobrando de menos', async () => {
    cobroPendiente()
    reservaSaldada()
    respuestas['consumos:select'] = { error: { message: 'sin conexión' } }
    const res = await llamar()
    expect(res.status).toBe(500)
    expect(hizo('reservas', 'update')).toBe(false)
  })

  /*
    El contraste de importe. Es la defensa contra un link manipulado o un evento
    cruzado de otra reserva: la pasarela cobra exactamente lo que se le pidió, así
    que cualquier diferencia es una anomalía y saldar sería lo caro.
  */
  it('un importe distinto del pedido NO salda la reserva y queda marcado', async () => {
    cobroPendiente(100)
    reservaSaldada()
    lectura = eventoCon({ monto: 5 })
    const res = await llamar()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ revisar: expect.any(String) })
    expect(hizo('reservas', 'update')).toBe(false)
    // Sí deja constancia sobre el pago.
    expect(hizo('pagos', 'update')).toBe(true)
  })

  it('un pago pendiente no salda la reserva', async () => {
    cobroPendiente()
    reservaSaldada()
    lectura = eventoCon({ estado: 'pendiente' })
    const res = await llamar()
    expect(res.status).toBe(200)
    expect(hizo('reservas', 'update')).toBe(false)
  })

  it('un cobro que el sistema no originó se inserta con su reserva', async () => {
    // Sin fila previa: alguien cobró desde el panel de la pasarela.
    respuestas['pagos:select:one'] = { data: null, error: null }
    reservaSaldada()
    const res = await llamar()
    expect(res.status).toBe(200)
    expect(hizo('pagos', 'insert')).toBe(true)
  })

  it('un evento que no habla de un cobro nuestro responde 200, no 400', async () => {
    // Con 400, la pasarela acumula fallos y termina deshabilitando el endpoint:
    // ahí se pierden también los avisos de los cobros buenos.
    lectura = { tipo: 'ignorar', motivo: 'evento de suscripción' }
    const res = await llamar()
    expect(res.status).toBe(200)
    expect(hizo('pagos', 'insert')).toBe(false)
  })

  it('un evento inválido responde 400 y no reintenta', async () => {
    lectura = { tipo: 'invalido', motivo: 'sin external_id' }
    expect((await llamar()).status).toBe(400)
  })

  it('un fallo transitorio responde 500 para que la pasarela reintente', async () => {
    // Distinguirlo de «inválido» importa: con 400, MercadoPago descarta el aviso
    // para siempre y ese cobro no se entera nunca más.
    lectura = { tipo: 'reintentar', motivo: 'la API no respondió' }
    expect((await llamar()).status).toBe(500)
  })

  it('una firma inválida responde 401 y no toca la base', async () => {
    firmaValida = false
    const res = await llamar()
    expect(res.status).toBe(401)
    expect(ejecutadas).toHaveLength(0)
  })
})
