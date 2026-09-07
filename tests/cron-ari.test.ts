import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tests del cron que publica disponibilidad al canal (`/api/cron/ari`).
 *
 * ── Qué se verifica acá ─────────────────────────────────────────────────────
 *
 * El borde, no el cálculo: el ARI se prueba puro en `tests/ari.test.ts`. Lo que
 * importa de este handler es que **rechace sin secreto** —le habla a un canal
 * externo— y, sobre todo, que **«no puedo publicar» responda 200**.
 *
 * Eso último no es un detalle de estilo. Con los dos caminos disponibles hoy
 * —informe CSV y feed iCal, ambos de solo lectura— el proveedor siempre va a
 * responder `noSoportado`. Si eso devolviera 500, el cron quedaría marcado como
 * fallando **para siempre**, y el día que sí haya un channel manager un fallo real
 * se perdería entre el ruido de un año de rojo.
 */

const SECRETO = 'secreto-de-prueba'

/** Lo que devuelve `publicarAri` en cada caso. */
let resultado: {
  ok: boolean
  noSoportado: boolean
  detalle: string
  aceptadas: number
  resumen: Record<string, number>
}
/** `true` para que `publicarAri` lance, como si el canal cortara la conexión. */
let explota = false
let llamadas = 0

vi.mock('@/lib/canales/ari', () => ({
  publicarAri: async () => {
    llamadas++
    if (explota) throw new Error('el canal cortó')
    return resultado
  },
}))

vi.mock('@/lib/acciones', () => ({
  registrarFalla: () => {},
}))

function pedido(cabecera?: string): Request {
  return new Request('https://h.local/api/cron/ari', {
    method: 'POST',
    headers: cabecera ? { authorization: cabecera } : {},
  })
}

describe('cron de publicación de disponibilidad', () => {
  beforeEach(() => {
    llamadas = 0
    explota = false
    resultado = {
      ok: true,
      noSoportado: false,
      detalle: 'Se publicaron 730 de 730 filas.',
      aceptadas: 730,
      resumen: { filas: 730, nochesAbiertas: 700, nochesCerradas: 30, sinPrecio: 0, tipos: 2 },
    }
    process.env.CRON_SECRET = SECRETO
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
    vi.resetModules()
  })

  async function llamar(cabecera?: string) {
    const { POST } = await import('@/app/api/cron/ari/route')
    return POST(pedido(cabecera))
  }

  it('sin CRON_SECRET configurada, rechaza y no publica nada', async () => {
    // Dejar pasar convertiría esto en un endpoint público que le habla a un canal
    // externo. Es el mismo criterio del ADR 0018.
    delete process.env.CRON_SECRET

    const res = await llamar(`Bearer ${SECRETO}`)

    expect(res.status).toBe(503)
    expect(llamadas).toBe(0)
  })

  it('sin cabecera, 401', async () => {
    const res = await llamar()

    expect(res.status).toBe(401)
    expect(llamadas).toBe(0)
  })

  it('con el secreto equivocado, 401 sin decir por qué', async () => {
    // Decir «el secreto no coincide» le confirma a quien prueba que el endpoint
    // existe y que el esquema es un Bearer.
    const res = await llamar('Bearer otro')
    const cuerpo = (await res.json()) as { error: string }

    expect(res.status).toBe(401)
    expect(cuerpo.error).toBe('no autorizado')
    expect(llamadas).toBe(0)
  })

  it('publica y devuelve el resumen', async () => {
    const res = await llamar(`Bearer ${SECRETO}`)
    const cuerpo = (await res.json()) as { ok: boolean; aceptadas: number }

    expect(res.status).toBe(200)
    expect(cuerpo.ok).toBe(true)
    expect(cuerpo.aceptadas).toBe(730)
    expect(llamadas).toBe(1)
  })

  it('«el proveedor no puede publicar» es 200, no 500', async () => {
    /*
      El caso más importante del archivo, y el que se da HOY en todas las corridas.

      Con 500, el cron quedaría en rojo permanente y el día que haya channel
      manager un fallo de verdad no se distinguiría. El cuerpo lleva `noSoportado`
      para que un 200 no se lea como «salió todo bien».
    */
    resultado = {
      ok: false,
      noSoportado: true,
      detalle: 'El proveedor de canal configurado es de solo lectura.',
      aceptadas: 0,
      resumen: { filas: 730, nochesAbiertas: 700, nochesCerradas: 30, sinPrecio: 0, tipos: 2 },
    }

    const res = await llamar(`Bearer ${SECRETO}`)
    const cuerpo = (await res.json()) as { ok: boolean; noSoportado: boolean; motivo: string }

    expect(res.status).toBe(200)
    expect(cuerpo.ok).toBe(false)
    expect(cuerpo.noSoportado, 'un 200 sin esta bandera se lee como éxito').toBe(true)
    expect(cuerpo.motivo).toContain('solo lectura')
  })

  it('un fallo REAL sí es 500, para que se reintente', async () => {
    // Distinto del caso anterior: acá algo salió mal y reintentar puede arreglarlo.
    resultado = {
      ok: false,
      noSoportado: false,
      detalle: 'No se pudo leer el mapeo de tipos.',
      aceptadas: 0,
      resumen: { filas: 0, nochesAbiertas: 0, nochesCerradas: 0, sinPrecio: 0, tipos: 0 },
    }

    const res = await llamar(`Bearer ${SECRETO}`)

    expect(res.status).toBe(500)
  })

  it('si el canal corta la conexión, 500 y no se propaga la excepción', async () => {
    explota = true

    const res = await llamar(`Bearer ${SECRETO}`)

    expect(res.status).toBe(500)
  })
})
