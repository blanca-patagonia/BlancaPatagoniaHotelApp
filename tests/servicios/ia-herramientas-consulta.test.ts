import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Las herramientas de consulta que el asistente sumó el 2026-10-20 (cuenta de
 * una reserva, mantenimiento, agencias, salud del sistema), con una base
 * simulada: se fija la CUENTA que hacen y lo que NO devuelven.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/acciones', () => ({ registrarFalla: vi.fn() }))

/** Lo que devuelve cada tabla en el test actual. */
let RESPUESTAS: Record<string, { data: unknown; error: unknown; count?: number }> = {}

function constructor(tabla: string) {
  const r = () => RESPUESTAS[tabla] ?? { data: [], error: null, count: 0 }
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'ilike', 'order', 'limit', 'or']) c[m] = () => c
  c.maybeSingle = async () => r()
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve(r()).then(ok)
  return c
}
vi.mock('@/lib/supabase/server', () => ({
  crearClienteServidor: async () => ({ from: constructor, rpc: async () => ({ data: [], error: null }) }),
}))

const { ejecutarHerramienta } = await import('@/app/(front-gestion)/panel/ia/herramientas')

beforeEach(() => {
  RESPUESTAS = {}
})

describe('cuenta_de_reserva', () => {
  it('detalla consumos y pagos y calcula el saldo con la cuenta consolidada', async () => {
    RESPUESTAS.reservas = {
      error: null,
      data: {
        id: 'r1',
        codigo: 'BP-1',
        estado: 'in_house',
        total: '200',
        pagos: [
          { tipo: 'sena', monto: '50', estado: 'aprobado', medio: 'efectivo', creado_en: '2026-10-19T23:30:00Z' },
          { tipo: 'saldo', monto: '30', estado: 'rechazado', medio: 'tarjeta', creado_en: '2026-10-20T12:00:00Z' },
        ],
        consumos: [{ cantidad: 2, precio_unitario: '12.5', fecha: '2026-10-19', producto: { nombre: 'Desayuno' } }],
        facturas: null,
      },
    }
    const r = await ejecutarHerramienta('cuenta_de_reserva', JSON.stringify({ codigo_reserva: 'bp‑1' }), 'recepcion')
    expect(r).toMatchObject({
      codigo: 'BP-1',
      enlace: '/panel/reservas/r1',
      alojamientoUsd: 200,
      totalConsumosUsd: 25,
      totalUsd: 225,
      pagadoUsd: 50,
      saldoUsd: 175,
      facturada: false,
    })
    // La fecha del pago es la del HOTEL (23:30 UTC del 19 = 20:30 del 19 en El Calafate).
    expect((r.pagos as { fecha: string }[])[0].fecha).toBe('2026-10-19')
  })

  it('una lectura fallida dice «no se pudo leer», nunca «no existe»', async () => {
    RESPUESTAS.reservas = { data: null, error: { message: 'timeout' } }
    const r = await ejecutarHerramienta('cuenta_de_reserva', '{"codigo_reserva":"BP-1"}', 'admin')
    expect(String(r.error)).toMatch(/No se pudo leer/)
  })
})

describe('ordenes_mantenimiento', () => {
  it('ordena por prioridad y tapa datos personales del título', async () => {
    RESPUESTAS.ordenes_mantenimiento = {
      error: null,
      data: [
        { id: 'o1', titulo: 'Cambiar lámpara', prioridad: 'baja', estado: 'pendiente', creada_en: '2026-10-01T12:00:00Z', resuelta_en: null, unidad: null },
        { id: 'o2', titulo: 'Llamar al 2902 412345 por la ducha', prioridad: 'alta', estado: 'en_proceso', creada_en: '2026-10-18T12:00:00Z', resuelta_en: null, unidad: { nombre: 'Hab 12' } },
      ],
    }
    const r = (await ejecutarHerramienta('ordenes_mantenimiento', '{}', 'housekeeping')) as {
      altas: number
      ordenes: { titulo: string; prioridad: string; estado: string; enlace: string }[]
    }
    expect(r.altas).toBe(1)
    expect(r.ordenes[0]).toMatchObject({ prioridad: 'alta', estado: 'en proceso', enlace: '/panel/mantenimiento/o2' })
    expect(r.ordenes[0].titulo).not.toMatch(/412345/)
  })
})

describe('cuentas_agencias', () => {
  it('cruza el saldo de la vista con cada agencia y suma lo que hay que cobrar', async () => {
    RESPUESTAS.agencias = {
      error: null,
      data: [
        { id: 'a1', nombre: 'Patagonia Travel', tipo: 'agencia', activo: true },
        { id: 'a2', nombre: 'Al día SRL', tipo: 'empresa', activo: true },
      ],
    }
    RESPUESTAS.saldos_agencias = {
      error: null,
      data: [
        { agencia_id: 'a1', saldo: '1200.5' },
        { agencia_id: 'a2', saldo: '0' },
      ],
    }
    const r = (await ejecutarHerramienta('cuentas_agencias', '{}', 'gerencia')) as {
      cantidad: number
      totalACobrarUsd: number
      cuentas: { nombre: string; saldoUsd: number }[]
    }
    expect(r.cantidad).toBe(1)
    expect(r.totalACobrarUsd).toBe(1200.5)
    expect(r.cuentas[0]).toMatchObject({ nombre: 'Patagonia Travel', saldoUsd: 1200.5 })
  })
})

describe('salud_del_sistema', () => {
  it('agrupa los eventos de las últimas 24 horas sin devolver su detalle', async () => {
    RESPUESTAS.errores = {
      error: null,
      count: 2,
      data: [
        { evento: 'escritura_fallida', nivel: 'error' },
        { evento: 'escritura_fallida', nivel: 'error' },
        { evento: 'ia_herramienta', nivel: 'aviso' },
      ],
    }
    RESPUESTAS.notificaciones = { data: null, error: null, count: 3 }
    const r = (await ejecutarHerramienta('salud_del_sistema', '{}', 'admin')) as {
      masRepetidos24h: { evento: string; veces: number }[]
      avisosQueFallaron: number
    }
    expect(r.masRepetidos24h[0]).toEqual({ evento: 'escritura_fallida', veces: 2, nivel: 'error' })
    expect(r.avisosQueFallaron).toBe(3)
    expect(JSON.stringify(r)).not.toMatch(/detalle/)
  })
})

describe('ejecutarHerramienta', () => {
  it('un nombre que no está en la tabla vuelve como error, sin lanzar', async () => {
    expect(await ejecutarHerramienta('borrar_todo', '{}', 'admin')).toEqual({
      error: 'Herramienta desconocida: borrar_todo',
    })
    // Ni siquiera las propiedades heredadas de Object cuentan como herramienta.
    expect(await ejecutarHerramienta('constructor', '{}', 'admin')).toEqual({
      error: 'Herramienta desconocida: constructor',
    })
  })
})
