import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tests del cron de mantenimiento.
 *
 * ── Por qué este endpoint existe ────────────────────────────────────────────
 *
 * Cuatro de las cinco tareas que dispara son funciones de Postgres que sólo
 * corría pg_cron (migración 0027), programado dentro de un bloque que **se
 * traga el fallo**: si la extensión no quedó activa, nada protesta y las
 * tareas no corren. La más cara es `expirar_reservas_pendientes`, que es la
 * que libera el inventario retenido por las reservas web sin seña — sin ella
 * cada reserva abandonada bloquea una unidad para siempre. La quinta,
 * `vencer_contratos`, no es una función de la base: es el mismo `update`
 * directo que antes solo corría a mano desde `/panel/contratos`.
 *
 * ── Qué se verifica ────────────────────────────────────────────────────────
 *
 * Igual que el cron de canales: este handler escribe con `service_role` y lo
 * único que lo protege es un secreto en una cabecera. Lo que importa es que
 * **rechace**, y que una tarea que falla no se lleve puestas a las otras —ni
 * siquiera si esa tarea lanza una excepción en vez de devolver `{ error }`,
 * que es justamente la forma en que puede fallar `vencer_contratos`—. La base
 * va falseada: lo que se prueba es el borde, no que Postgres responda.
 */

const SECRETO = 'secreto-de-prueba'

/** Qué RPC se llamaron, en orden. */
let llamadas: { rpc: string; args: unknown }[] = []
/** RPC que devuelven error, para probar el aislamiento entre tareas. */
let fallan: Set<string> = new Set()
/** `vencer_contratos` lanza en vez de devolver `{ error }`, para probar ese camino aparte. */
let contratosLanza = false
/** Filas que «actualiza» `vencer_contratos` cuando no fallan ni lanzan. */
let contratosActualizados: { id: string }[] = [{ id: 'contrato-1' }]

/** Mock fluido de `admin.from('contratos').update(...).eq(...).not(...).lt(...).select(...)`. */
function clienteContratos() {
  const builder = {
    update: () => builder,
    eq: () => builder,
    not: () => builder,
    lt: () => builder,
    select: async () => {
      if (contratosLanza) throw new Error('se cortó la conexión')
      if (fallan.has('vencer_contratos')) {
        return { data: null, error: { message: 'falló vencer_contratos' } }
      }
      return { data: contratosActualizados, error: null }
    },
  }
  return builder
}

vi.mock('@/lib/supabase/admin', () => ({
  crearClienteAdmin: () => ({
    rpc: async (nombre: string, args: unknown) => {
      llamadas.push({ rpc: nombre, args })
      if (fallan.has(nombre)) return { data: null, error: { message: `falló ${nombre}` } }
      return { data: 1, error: null }
    },
    from: (tabla: string) => {
      if (tabla === 'contratos') return clienteContratos()
      throw new Error(`tabla no mockeada: ${tabla}`)
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
    contratosLanza = false
    contratosActualizados = [{ id: 'contrato-1' }]
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

  it('con el secreto correcto corre las cuatro funciones de Postgres', async () => {
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

  it('también vence los contratos, sin pasar por rpc', async () => {
    const { POST } = await import('@/app/api/cron/mantenimiento/route')

    const r = await POST(await pedido(`Bearer ${SECRETO}`))
    const cuerpo = (await r.json()) as { hechas: Record<string, number> }

    expect(r.status).toBe(200)
    // Una sola fila en `contratosActualizados`: tiene que contarla bien.
    expect(cuerpo.hechas.vencer_contratos).toBe(1)
    // No es una función de Postgres: no deja rastro en `llamadas` (que sólo
    // registra `.rpc()`), aunque sí corrió — lo prueba el assert de arriba.
    expect(llamadas.some((l) => l.rpc === 'vencer_contratos')).toBe(false)
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
    único de las cinco que le cuesta plata al hotel.
  */
  it('una tarea que falla no frena a las otras', async () => {
    fallan.add('vencer_comprobantes_proveedor')
    const { POST } = await import('@/app/api/cron/mantenimiento/route')

    const r = await POST(await pedido(`Bearer ${SECRETO}`))
    const cuerpo = (await r.json()) as { ok: boolean; fallidas: string[]; hechas: Record<string, number> }

    expect(llamadas, 'la tarea que falló cortó las siguientes').toHaveLength(4)
    expect(cuerpo.fallidas).toEqual(['vencer_comprobantes_proveedor'])
    expect(cuerpo.hechas.purgar_errores, 'la tarea posterior no llegó a correr').toBe(1)
    // Y la quinta, que ni siquiera es una de las que fallan acá, tampoco se frena.
    expect(cuerpo.hechas.vencer_contratos).toBe(1)
    // 500 para que Vercel lo marque y lo reintente: las que sí corrieron son
    // idempotentes, así que reintentar no duplica nada.
    expect(r.status).toBe(500)
    expect(cuerpo.ok).toBe(false)
  })

  it('si vencer_contratos devuelve { error }, no frena a purgar_errores', async () => {
    fallan.add('vencer_contratos')
    const { POST } = await import('@/app/api/cron/mantenimiento/route')

    const r = await POST(await pedido(`Bearer ${SECRETO}`))
    const cuerpo = (await r.json()) as { fallidas: string[]; hechas: Record<string, number> }

    expect(cuerpo.fallidas).toEqual(['vencer_contratos'])
    expect(cuerpo.hechas.purgar_errores).toBe(1)
    expect(r.status).toBe(500)
  })

  it('si vencer_contratos LANZA en vez de devolver { error }, tampoco frena a las demás', async () => {
    contratosLanza = true
    const { POST } = await import('@/app/api/cron/mantenimiento/route')

    const r = await POST(await pedido(`Bearer ${SECRETO}`))
    const cuerpo = (await r.json()) as { fallidas: string[]; hechas: Record<string, number> }

    expect(cuerpo.fallidas).toEqual(['vencer_contratos'])
    // Las cuatro funciones de Postgres corrieron igual, pese a la excepción.
    expect(llamadas).toHaveLength(4)
    expect(cuerpo.hechas.purgar_errores).toBe(1)
    expect(r.status).toBe(500)
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
