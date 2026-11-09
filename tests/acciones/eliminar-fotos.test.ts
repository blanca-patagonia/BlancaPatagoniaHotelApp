import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { hayDB } from '../apoyo/db'
import { nuevoContexto, limpiar, destinoDe, formulario, type Contexto } from './entorno'

/**
 * `eliminarFotoOrden`
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
  const { clienteDePrueba } = await import('../apoyo/db')
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
    const { eliminarFotoOrden } = await import('@/app/(front-gestion)/panel/mantenimiento/actions')

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

  it('una ruta que no es de la orden no se borra del bucket (era cualquier archivo)', async () => {
    const { eliminarFotoOrden } = await import('@/app/(front-gestion)/panel/mantenimiento/actions')

    const { data } = await ctx.db
      .from('ordenes_mantenimiento')
      .insert({ titulo: `Orden ajena ${ctx.sufijo}`, fotos: ['mantenimiento/c.jpg'] })
      .select('id')
      .single()
    const ordenId = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'ordenes_mantenimiento', id: ordenId })

    const destino = await destinoDe(() =>
      eliminarFotoOrden(formulario({ orden_id: ordenId, ruta: 'agencias/comprobante-ajeno.pdf' })),
    )

    expect(destino).toBe(`/panel/mantenimiento/${ordenId}?error=foto_eliminar`)
    expect(rutasEliminadas).toEqual([])
  })
})
