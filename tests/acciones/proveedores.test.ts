import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../db'
import { nuevoContexto, limpiar, destinoDe, formulario, type Contexto } from './entorno'

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth/session', async () => {
  const { sesionActual } = await import('./entorno')
  return {
    obtenerSesion: async () => sesionActual(),
    requerirSesion: async () => sesionActual(),
    requerirAcceso: async () => sesionActual(),
  }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})

describe.skipIf(!hayDB)('Server Actions · proveedores', () => {
  let ctx: Contexto
  let proveedorId: string
  type Acciones = typeof import('@/app/panel/proveedores/actions')
  let registrarMovimiento: Acciones['registrarMovimientoProveedor']
  let marcarPagado: Acciones['marcarComprobantePagado']

  beforeAll(async () => {
    ctx = nuevoContexto()
    const acciones = await import('@/app/panel/proveedores/actions')
    registrarMovimiento = acciones.registrarMovimientoProveedor
    marcarPagado = acciones.marcarComprobantePagado

    const { data } = await ctx.db
      .from('proveedores')
      .insert({ nombre: `Proveedor Test ${ctx.sufijo}` })
      .select('id')
      .single()
    proveedorId = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'proveedores', id: proveedorId })
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  async function movimientos() {
    const { data } = await ctx.db
      .from('movimientos_proveedor')
      .select('id, tipo, monto, estado, vencimiento, comprobante')
      .eq('proveedor_id', proveedorId)
      .order('creado_en')
    return (data ?? []) as {
      id: string
      tipo: string
      monto: number
      estado: string
      vencimiento: string | null
      comprobante: string | null
    }[]
  }

  it('guarda el vencimiento y el número de comprobante de una factura', async () => {
    await destinoDe(() =>
      registrarMovimiento(
        formulario({
          proveedor_id: proveedorId,
          tipo: 'cargo',
          monto: 300,
          concepto: 'Lavado de blancos',
          comprobante: '0001-00000045',
          vencimiento: '2026-09-15',
        }),
      ),
    )

    const [m] = await movimientos()
    // El vencimiento es lo que alimenta el reporte de antigüedad: si el
    // formulario deja de mandarlo, el informe queda inerte y nadie se entera.
    expect(m.vencimiento).toBe('2026-09-15')
    expect(m.comprobante).toBe('0001-00000045')
    expect(m.estado).toBe('pendiente')
  })

  it('un PAGO no lleva vencimiento y nace saldado', async () => {
    await destinoDe(() =>
      registrarMovimiento(
        formulario({
          proveedor_id: proveedorId,
          tipo: 'pago',
          monto: 100,
          concepto: 'Pago parcial',
          vencimiento: '2026-09-15',
        }),
      ),
    )

    const pago = (await movimientos()).find((m) => m.tipo === 'pago')!
    expect(pago.estado).toBe('pagado')
    // Aunque el formulario mande fecha, en un pago no tiene sentido.
    expect(pago.vencimiento).toBeNull()
  })

  it('marcar pagado cambia el estado del comprobante', async () => {
    const cargo = (await movimientos()).find((m) => m.tipo === 'cargo')!
    await destinoDe(() =>
      marcarPagado(formulario({ movimiento_id: cargo.id, proveedor_id: proveedorId })),
    )

    const actualizado = (await movimientos()).find((m) => m.id === cargo.id)!
    expect(actualizado.estado).toBe('pagado')
  })

  it('ignora un monto inválido en lugar de guardar basura', async () => {
    const antes = (await movimientos()).length
    await destinoDe(() =>
      registrarMovimiento(
        formulario({ proveedor_id: proveedorId, tipo: 'cargo', monto: 0, concepto: 'Nada' }),
      ),
    )
    expect((await movimientos()).length).toBe(antes)
  })

  it('la vista de saldos coincide con los movimientos cargados', async () => {
    const movs = await movimientos()
    const esperado =
      movs.filter((m) => m.tipo === 'cargo').reduce((a, m) => a + Number(m.monto), 0) -
      movs.filter((m) => m.tipo === 'pago').reduce((a, m) => a + Number(m.monto), 0)

    const { data } = await ctx.db
      .from('saldos_proveedores')
      .select('saldo')
      .eq('proveedor_id', proveedorId)
      .single()

    // El saldo lo calcula la base: este test es el que detecta si la vista y
    // los movimientos se desincronizan.
    expect(Number((data as { saldo: number }).saldo)).toBeCloseTo(esperado, 2)
  })
})
