import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { hayDB } from '../db'
import { nuevoContexto, limpiar, destinoDe, formulario, type Contexto } from './entorno'

/**
 * `eliminarFotoOrden`, `eliminarFotoProveedor` y `eliminarComprobantePagoAgencia`
 * (auditoría QA/UX 2026-10): `eliminarAdjunto` existía desde la migración 0099
 * y nadie lo llamaba — una foto equivocada, o con datos personales de un
 * huésped de fondo, quedaba para siempre. Lo que se prueba acá es la lógica de
 * negocio (qué fila de la base queda y cómo), no Supabase Storage: `@/lib/storage`
 * se falsea para no depender de un bucket real.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth/session', async () => {
  const { sesionActual } = await import('./entorno')
  return {
    requerirAcceso: async () => sesionActual(),
    requerirRol: async () => sesionActual(),
  }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})
vi.mock('@/lib/registro', () => ({ registrarAviso: async () => {} }))

const rutasEliminadas: string[] = []
vi.mock('@/lib/storage', () => ({
  eliminarAdjunto: async (ruta: string) => {
    rutasEliminadas.push(ruta)
  },
}))

describe.skipIf(!hayDB)('Server Actions · eliminar fotos adjuntas', () => {
  let ctx: Contexto

  beforeAll(() => {
    ctx = nuevoContexto()
  })

  afterEach(() => {
    rutasEliminadas.length = 0
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  it('eliminarFotoOrden saca la ruta del arreglo y borra del bucket', async () => {
    const { eliminarFotoOrden } = await import('@/app/panel/mantenimiento/actions')

    const { data } = await ctx.db
      .from('ordenes_mantenimiento')
      .insert({ titulo: `Orden test ${ctx.sufijo}`, fotos: ['mantenimiento/a.jpg', 'mantenimiento/b.jpg'] })
      .select('id')
      .single()
    const ordenId = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'ordenes_mantenimiento', id: ordenId })

    const destino = await destinoDe(() =>
      eliminarFotoOrden(formulario({ orden_id: ordenId, ruta: 'mantenimiento/a.jpg' })),
    )

    expect(destino).toBe(`/panel/mantenimiento/${ordenId}?ok=foto_eliminada`)
    expect(rutasEliminadas).toEqual(['mantenimiento/a.jpg'])

    const { data: actual } = await ctx.db
      .from('ordenes_mantenimiento')
      .select('fotos')
      .eq('id', ordenId)
      .single()
    // Se va la que se pidió y la otra queda — no es un vaciado del arreglo entero.
    expect((actual as { fotos: string[] }).fotos).toEqual(['mantenimiento/b.jpg'])
  })

  it('eliminarFotoProveedor saca la ruta del arreglo y borra del bucket', async () => {
    const { eliminarFotoProveedor } = await import('@/app/panel/proveedores/actions')

    const { data } = await ctx.db
      .from('proveedores')
      .insert({ nombre: `Proveedor test ${ctx.sufijo}`, fotos: ['proveedores/habilitacion.pdf'] })
      .select('id')
      .single()
    const proveedorId = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'proveedores', id: proveedorId })

    const destino = await destinoDe(() =>
      eliminarFotoProveedor(formulario({ proveedor_id: proveedorId, ruta: 'proveedores/habilitacion.pdf' })),
    )

    expect(destino).toBe(`/panel/proveedores/${proveedorId}?ok=foto_eliminada`)

    const { data: actual } = await ctx.db
      .from('proveedores')
      .select('fotos')
      .eq('id', proveedorId)
      .single()
    expect((actual as { fotos: string[] }).fotos).toEqual([])
  })

  it('eliminarComprobantePagoAgencia limpia la columna sin borrar el movimiento', async () => {
    const { eliminarComprobantePagoAgencia } = await import('@/app/panel/agencias/actions')

    const { data: agencia } = await ctx.db
      .from('agencias')
      .insert({ nombre: `Agencia test ${ctx.sufijo}` })
      .select('id')
      .single()
    const agenciaId = (agencia as { id: string }).id
    ctx.aBorrar.push({ tabla: 'agencias', id: agenciaId })

    const { data: mov } = await ctx.db
      .from('movimientos_cuenta')
      .insert({
        agencia_id: agenciaId,
        tipo: 'pago',
        monto: 100,
        moneda: 'USD',
        concepto: 'Seña',
        comprobante_ruta: 'agencias/comprobante.jpg',
      })
      .select('id')
      .single()
    const movimientoId = (mov as { id: string }).id
    ctx.aBorrar.push({ tabla: 'movimientos_cuenta', id: movimientoId })

    const destino = await destinoDe(() =>
      eliminarComprobantePagoAgencia(
        formulario({ agencia_id: agenciaId, movimiento_id: movimientoId, ruta: 'agencias/comprobante.jpg' }),
      ),
    )

    expect(destino).toBe(`/panel/agencias/${agenciaId}?ok=comprobante_eliminado`)

    const { data: actual } = await ctx.db
      .from('movimientos_cuenta')
      .select('comprobante_ruta, monto, concepto')
      .eq('id', movimientoId)
      .single()
    const fila = actual as { comprobante_ruta: string | null; monto: number; concepto: string }
    expect(fila.comprobante_ruta).toBeNull()
    // El movimiento de dinero en sí queda intacto: sólo se borró el archivo.
    expect(Number(fila.monto)).toBe(100)
    expect(fila.concepto).toBe('Seña')
  })

  it('no toca el movimiento si la ruta ya no coincide (comprobante reemplazado entre tanto)', async () => {
    const { eliminarComprobantePagoAgencia } = await import('@/app/panel/agencias/actions')

    const { data: agencia } = await ctx.db
      .from('agencias')
      .insert({ nombre: `Agencia test 2 ${ctx.sufijo}` })
      .select('id')
      .single()
    const agenciaId = (agencia as { id: string }).id
    ctx.aBorrar.push({ tabla: 'agencias', id: agenciaId })

    const { data: mov } = await ctx.db
      .from('movimientos_cuenta')
      .insert({
        agencia_id: agenciaId,
        tipo: 'pago',
        monto: 50,
        moneda: 'USD',
        comprobante_ruta: 'agencias/vigente.jpg',
      })
      .select('id')
      .single()
    const movimientoId = (mov as { id: string }).id
    ctx.aBorrar.push({ tabla: 'movimientos_cuenta', id: movimientoId })

    // Pide borrar una ruta vieja, no la que la fila tiene hoy.
    await destinoDe(() =>
      eliminarComprobantePagoAgencia(
        formulario({ agencia_id: agenciaId, movimiento_id: movimientoId, ruta: 'agencias/vencida.jpg' }),
      ),
    )

    const { data: actual } = await ctx.db
      .from('movimientos_cuenta')
      .select('comprobante_ruta')
      .eq('id', movimientoId)
      .single()
    expect((actual as { comprobante_ruta: string | null }).comprobante_ruta).toBe('agencias/vigente.jpg')
  })
})
