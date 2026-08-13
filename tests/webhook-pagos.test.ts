import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WebhookEvent } from '@/lib/payments'

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
  verbo: 'select' | 'insert' | 'update'
}

interface Resultado {
  data?: unknown
  error?: { message: string; code?: string } | null
}

/** Operaciones que registró el cliente falso, en orden. */
let ejecutadas: Op[] = []
/** Respuesta para cada `tabla:verbo`. Lo que no esté definido sale sin error. */
let respuestas: Record<string, Resultado> = {}

/**
 * Cliente de Supabase falseado.
 *
 * El builder de PostgREST es *thenable* y encadenable: acumula la operación y la
 * resuelve recién en el `await`. Se imita eso mismo, que es justo lo que hace
 * que el código de producción pueda escribirse encadenado.
 */
function clienteFalso() {
  return {
    from(tabla: string) {
      const op: Op = { tabla, verbo: 'select' }
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
          op.verbo = 'select'
          return builder
        },
        eq() {
          return builder
        },
        maybeSingle() {
          return builder
        },
        // `single` existe además de `maybeSingle` para que estos tests sirvan
        // como regresión: hay que poder correrlos contra la versión anterior del
        // handler, que usaba `single`. Si el falso no lo implementara, el código
        // viejo se caería por eso y no por el fallo que se quiere demostrar.
        single() {
          return builder
        },
        then(resolver: (r: Resultado) => unknown, rechazar?: (e: unknown) => unknown) {
          ejecutadas.push({ ...op })
          const r = respuestas[`${op.tabla}:${op.verbo}`] ?? { data: null, error: null }
          return Promise.resolve(r).then(resolver, rechazar)
        },
      }
      return builder
    },
  }
}

let evento: WebhookEvent

vi.mock('@/lib/supabase/admin', () => ({ crearClienteAdmin: () => clienteFalso() }))
vi.mock('@/lib/payments', () => ({
  obtenerProveedor: () => ({
    nombre: 'generico',
    crearCheckout: async () => ({ url: '' }),
    verificarFirma: async () => true,
    parsearWebhook: async () => evento,
  }),
}))

/** Llama al handler con un cuerpo cualquiera: el proveedor está falseado. */
async function llamar() {
  const { POST } = await import('@/app/api/webhooks/pagos/[proveedor]/route')
  const req = new Request('http://local/api/webhooks/pagos/generico', {
    method: 'POST',
    body: '{}',
  })
  return POST(req, { params: Promise.resolve({ proveedor: 'generico' }) })
}

/** Una reserva `confirmada` de 100 con un pago aprobado de 100: queda saldada. */
function reservaSaldada() {
  respuestas['reservas:select'] = { data: { estado: 'confirmada', total: 100 }, error: null }
  respuestas['pagos:select'] = {
    data: [{ tipo: 'saldo', monto: 100, estado: 'aprobado' }],
    error: null,
  }
}

const hizo = (tabla: string, verbo: Op['verbo']) =>
  ejecutadas.some((o) => o.tabla === tabla && o.verbo === verbo)

describe('webhook de pagos · fallar cerrado', () => {
  beforeEach(() => {
    ejecutadas = []
    respuestas = {}
    evento = {
      externalId: 'ext-1',
      reservaId: '11111111-1111-1111-1111-111111111111',
      monto: 100,
      medio: 'generico' as WebhookEvent['medio'],
      tipo: 'saldo' as WebhookEvent['tipo'],
      estado: 'aprobado' as WebhookEvent['estado'],
    }
  })

  it('marca la reserva como pagada y responde ok', async () => {
    reservaSaldada()
    const res = await llamar()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(hizo('reservas', 'update')).toBe(true)
  })

  it('responde 500 si no se pudo marcar la reserva como pagada', async () => {
    // El caso que importa: el pago YA quedó registrado. Responder ok acá deja la
    // plata cobrada y la reserva sin marcar, sin reintento posible.
    reservaSaldada()
    respuestas['reservas:update'] = { error: { message: 'deadlock detected' } }
    const res = await llamar()
    expect(res.status).toBe(500)
  })

  it('responde 500 si no se pudieron leer los pagos', async () => {
    // Un error de lectura daría «no saldada» y saltearía la transición por un
    // problema de infraestructura, respondiendo ok. Mismo fallo silencioso.
    respuestas['reservas:select'] = { data: { estado: 'confirmada', total: 100 }, error: null }
    respuestas['pagos:select'] = { error: { message: 'statement timeout' } }
    const res = await llamar()
    expect(res.status).toBe(500)
    expect(hizo('reservas', 'update')).toBe(false)
  })

  it('responde 500 si no se pudo leer la reserva', async () => {
    respuestas['reservas:select'] = { error: { message: 'connection reset' } }
    const res = await llamar()
    expect(res.status).toBe(500)
  })

  it('un evento repetido vuelve a intentar la transición', async () => {
    // Es el modo de reparar una transición que quedó a medias: la fila de `pagos`
    // ya existe, así que el insert choca con la restricción única. Si el handler
    // cortara por «duplicado», la inconsistencia sería permanente.
    respuestas['pagos:insert'] = { error: { message: 'duplicate key', code: '23505' } }
    reservaSaldada()
    const res = await llamar()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, duplicado: true })
    expect(hizo('reservas', 'update')).toBe(true)
  })

  it('no transiciona si los pagos todavía no saldan el total', async () => {
    respuestas['reservas:select'] = { data: { estado: 'confirmada', total: 100 }, error: null }
    respuestas['pagos:select'] = {
      data: [{ tipo: 'senia', monto: 30, estado: 'aprobado' }],
      error: null,
    }
    const res = await llamar()
    expect(res.status).toBe(200)
    expect(hizo('reservas', 'update')).toBe(false)
  })

  it('no transiciona una reserva anulada, aunque esté saldada', async () => {
    // `cancelada` es terminal: la máquina de estados no permite pasar a pagada.
    // Qué hacer con esa plata es decisión del hotel, no del webhook.
    respuestas['reservas:select'] = { data: { estado: 'cancelada', total: 100 }, error: null }
    respuestas['pagos:select'] = {
      data: [{ tipo: 'saldo', monto: 100, estado: 'aprobado' }],
      error: null,
    }
    const res = await llamar()
    expect(res.status).toBe(200)
    expect(hizo('reservas', 'update')).toBe(false)
  })

  it('propaga el fallo del insert que no es duplicado', async () => {
    respuestas['pagos:insert'] = { error: { message: 'null value in column' } }
    const res = await llamar()
    expect(res.status).toBe(500)
    expect(hizo('reservas', 'select')).toBe(false)
  })
})
