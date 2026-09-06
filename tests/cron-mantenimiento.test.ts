import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tests del cron de mantenimiento.
 *
 * ── Por qué este endpoint existe ────────────────────────────────────────────
 *
 * Las cuatro funciones que dispara sólo las corría pg_cron (migración 0027),
 * programado dentro de un bloque que **se traga el fallo**: si la extensión no
 * quedó activa, nada protesta y las tareas no corren. La más cara es
 * `expirar_reservas_pendientes`, que es la que libera el inventario retenido por
 * las reservas web sin seña — sin ella cada reserva abandonada bloquea una unidad
 * para siempre.
 *
 * ── Qué se verifica ────────────────────────────────────────────────────────
 *
 * Igual que el cron de canales: este handler escribe con `service_role` y lo
 * único que lo protege es un secreto en una cabecera. Lo que importa es que
 * **rechace**, y que una tarea que falla no se lleve puestas a las otras. La base
 * va falseada: lo que se prueba es el borde, no que Postgres responda.
 */

const SECRETO = 'secreto-de-prueba'

/** Qué RPC se llamaron, en orden. */
let llamadas: { rpc: string; args: unknown }[] = []
/** RPC que devuelven error, para probar el aislamiento entre tareas. */
let fallan: Set<string> = new Set()

vi.mock('@/lib/supabase/admin', () => ({
  crearClienteAdmin: () => ({
    rpc: async (nombre: string, args: unknown) => {
      llamadas.push({ rpc: nombre, args })
      if (fallan.has(nombre)) return { data: null, error: { message: `falló ${nombre}` } }
      return { data: 1, error: null }
    },
  }),
}))

vi.mock('@/lib/registro', () => ({
  registrarError: async () => {},
  registrarInfo: async () => {},
}))

async function pedido(cabecera?: string): Promise<Request> {
  return new Request('https://h.local/api/cron/mantenimiento', {
    method: 'POST',
    headers: cabecera ? { authorization: cabecera } : {},
  })
}

describe('cron de mantenimiento', () => {
  beforeEach(() => {
    llamadas = []
    fallan = new Set()
    vi.stubEnv('CRON_SECRET', SECRETO)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sin CRON_SECRET configurado no corre nada', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const { POST } = await import('@/app/api/cron/mantenimiento/route')

    const r = await POST(await pedido(`Bearer ${SECRETO}`))

    expect(r.status, 'sin secreto tiene que fallar cerrado').toBe(503)
    expect(llamadas, 'corrió tareas sin estar configurado').toHaveLength(0)
  })

  it('rechaza un secreto que no coincide', async () => {
    const { POST } = await import('@/app/api/cron/mantenimiento/route')

    const r = await POST(await pedido('Bearer otro-secreto'))

    expect(r.status).toBe(401)
    expect(llamadas, 'corrió tareas sin autorización').toHaveLength(0)
  })

  it('rechaza un pedido sin cabecera', async () => {
    const { POST } = await import('@/app/api/cron/mantenimiento/route')
    expect((await POST(await pedido())).status).toBe(401)
  })

  it('con el secreto correcto corre las cuatro tareas', async () => {
    const { POST } = await import('@/app/api/cron/mantenimiento/route')

    const r = await POST(await pedido(`Bearer ${SECRETO}`))

    expect(r.status).toBe(200)
    expect(llamadas.map((l) => l.rpc)).toEqual([
      'expirar_reservas_pendientes',
      'vencer_comprobantes_proveedor',
      'generar_mantenimiento_preventivo',
      // La que nunca se había programado: sin ella la tabla `errores` crece sin techo.
      'purgar_errores',
    ])
  })

  it('la expiración se pide con los días que retiene una reserva pendiente', async () => {
    const { POST } = await import('@/app/api/cron/mantenimiento/route')
    await POST(await pedido(`Bearer ${SECRETO}`))

    const expirar = llamadas.find((l) => l.rpc === 'expirar_reservas_pendientes')
    expect(expirar?.args).toEqual({ p_dias: 5 })
  })

  /*
    El aislamiento entre tareas. Son independientes: que no se pueda purgar la
    tabla de errores no es motivo para dejar de liberar inventario, que es lo
    único de las cuatro que le cuesta plata al hotel.
  */
  it('una tarea que falla no frena a las otras', async () => {
    fallan.add('vencer_comprobantes_proveedor')
    const { POST } = await import('@/app/api/cron/mantenimiento/route')

    const r = await POST(await pedido(`Bearer ${SECRETO}`))
    const cuerpo = (await r.json()) as { ok: boolean; fallidas: string[]; hechas: Record<string, number> }

    expect(llamadas, 'la tarea que falló cortó las siguientes').toHaveLength(4)
    expect(cuerpo.fallidas).toEqual(['vencer_comprobantes_proveedor'])
    expect(cuerpo.hechas.purgar_errores, 'la tarea posterior no llegó a correr').toBe(1)
    // 500 para que Vercel lo marque y lo reintente: las que sí corrieron son
    // idempotentes, así que reintentar no duplica nada.
    expect(r.status).toBe(500)
    expect(cuerpo.ok).toBe(false)
  })

  it('Vercel dispara con GET y toma el mismo camino', async () => {
    const { GET } = await import('@/app/api/cron/mantenimiento/route')

    const r = await GET(
      new Request('https://h.local/api/cron/mantenimiento', {
        headers: { authorization: `Bearer ${SECRETO}` },
      }),
    )

    expect(r.status).toBe(200)
    expect(llamadas).toHaveLength(4)
  })
})
