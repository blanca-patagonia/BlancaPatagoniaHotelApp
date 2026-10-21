import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../apoyo/db'
import { nuevoContexto, limpiar, destinoDe, formulario, type Contexto } from './entorno'

/**
 * Fusión de huéspedes duplicados y derecho de supresión (auditoría QA/UX
 * 2026-10). El caso típico de la fusión es el huésped `Externo-xxxxxx` que
 * entra por un canal sin documento ni email y vuelve directo con sus datos
 * reales: hasta ahora quedaban como dos fichas separadas para siempre.
 *
 * Lo más importante que se prueba acá:
 * · La fusión reasigna reservas y acompañantes, suma los puntos, y borra el
 *   duplicado — todo en `fusionar_huespedes` (migración 0111).
 * · La anonimización borra el dato personal pero conserva las reservas y los
 *   puntos, y se bloquea si hay una estadía que todavía ocupa inventario.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth/session', async () => {
  const { sesionActual } = await import('./entorno')
  return { requerirAcceso: async () => sesionActual() }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../apoyo/db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})

describe.skipIf(!hayDB)('Server Actions · fusión y anonimización de huéspedes', () => {
  let ctx: Contexto
  let fusionarHuespedes: typeof import('@/app/(front-gestion)/panel/huespedes/actions')['fusionarHuespedes']
  let anonimizarHuesped: typeof import('@/app/(front-gestion)/panel/huespedes/actions')['anonimizarHuesped']

  beforeAll(async () => {
    ctx = nuevoContexto()
    const acciones = await import('@/app/(front-gestion)/panel/huespedes/actions')
    fusionarHuespedes = acciones.fusionarHuespedes
    anonimizarHuesped = acciones.anonimizarHuesped
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  async function crearHuesped(extra: Record<string, unknown> = {}) {
    const { data } = await ctx.db
      .from('huespedes')
      .insert({ nombre: 'Test', apellido: `Fusion-${ctx.sufijo}-${Math.random().toString(36).slice(2, 7)}`, ...extra })
      .select('id')
      .single()
    const id = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'huespedes', id })
    return id
  }

  describe('fusionarHuespedes', () => {
    it('reasigna las reservas, suma los puntos y borra el duplicado', async () => {
      const conservar = await crearHuesped({ puntos: 10 })
      const descartar = await crearHuesped({ puntos: 25 })

      const { data: reserva } = await ctx.db
        .from('reservas')
        .insert({ huesped_id: descartar, estado: 'checkout', total: 200 })
        .select('id')
        .single()
      const reservaId = (reserva as { id: string }).id
      ctx.aBorrar.push({ tabla: 'reservas', id: reservaId })

      const destino = await destinoDe(() =>
        fusionarHuespedes(formulario({ conservar_id: conservar, descartar_id: descartar })),
      )
      expect(destino).toBe(`/panel/huespedes/${conservar}?ok=fusionado`)

      const { data: reservaActual } = await ctx.db
        .from('reservas')
        .select('huesped_id')
        .eq('id', reservaId)
        .single()
      expect((reservaActual as { huesped_id: string }).huesped_id).toBe(conservar)

      const { data: conservado } = await ctx.db.from('huespedes').select('puntos').eq('id', conservar).single()
      expect((conservado as { puntos: number }).puntos).toBe(35)

      const { data: duplicado } = await ctx.db.from('huespedes').select('id').eq('id', descartar).maybeSingle()
      expect(duplicado, 'el duplicado tiene que haber desaparecido').toBeNull()

      // Ya se borró: que `limpiar()` no intente borrarlo de nuevo al final.
      ctx.aBorrar = ctx.aBorrar.filter((r) => !(r.tabla === 'huespedes' && r.id === descartar))
    })

    it('reasigna un acompañante sin chocar si ya estaba en la misma reserva (reserva_huespedes)', async () => {
      const conservar = await crearHuesped()
      const descartar = await crearHuesped()

      const { data: reserva } = await ctx.db
        .from('reservas')
        .insert({ huesped_id: conservar, estado: 'checkout', total: 100 })
        .select('id')
        .single()
      const reservaId = (reserva as { id: string }).id
      ctx.aBorrar.push({ tabla: 'reservas', id: reservaId })

      // El duplicado figura como acompañante de la MISMA reserva del titular
      // que se va a conservar: fusionar tendría que chocar contra la clave
      // primaria (reserva_id, huesped_id) si no usara `on conflict do nothing`.
      await ctx.db.from('reserva_huespedes').insert({ reserva_id: reservaId, huesped_id: descartar })

      const destino = await destinoDe(() =>
        fusionarHuespedes(formulario({ conservar_id: conservar, descartar_id: descartar })),
      )
      expect(destino).toBe(`/panel/huespedes/${conservar}?ok=fusionado`)

      const { data: duplicado } = await ctx.db.from('huespedes').select('id').eq('id', descartar).maybeSingle()
      expect(duplicado).toBeNull()
      ctx.aBorrar = ctx.aBorrar.filter((r) => !(r.tabla === 'huespedes' && r.id === descartar))
    })

    it('rechaza fusionar una ficha con sí misma', async () => {
      const id = await crearHuesped()
      const destino = await destinoDe(() => fusionarHuespedes(formulario({ conservar_id: id, descartar_id: id })))
      expect(destino).toBe(`/panel/huespedes/${id}?error=fusion_mismo_huesped`)

      const { data } = await ctx.db.from('huespedes').select('id').eq('id', id).maybeSingle()
      expect(data, 'no se tiene que haber borrado').not.toBeNull()
    })

    it('rechaza fusionar con un huésped que no existe', async () => {
      const conservar = await crearHuesped()
      const inexistente = '00000000-0000-0000-0000-000000000000'
      const destino = await destinoDe(() =>
        fusionarHuespedes(formulario({ conservar_id: conservar, descartar_id: inexistente })),
      )
      expect(destino).toBe(`/panel/huespedes/${conservar}?error=fusion_no_existe`)
    })
  })

  describe('anonimizarHuesped', () => {
    it('borra el dato personal pero conserva reservas y puntos', async () => {
      const id = await crearHuesped({
        email: 'real@ejemplo.com',
        telefono: '+54 11 1234-5678',
        doc_numero: '30111222',
        nacionalidad: 'Argentina',
        notas: 'Pidió piso bajo',
        puntos: 42,
      })
      const { data: reserva } = await ctx.db
        .from('reservas')
        .insert({ huesped_id: id, estado: 'checkout', total: 300 })
        .select('id')
        .single()
      const reservaId = (reserva as { id: string }).id
      ctx.aBorrar.push({ tabla: 'reservas', id: reservaId })

      const destino = await destinoDe(() => anonimizarHuesped(formulario({ huesped_id: id })))
      expect(destino).toBe(`/panel/huespedes/${id}?ok=anonimizado`)

      const { data } = await ctx.db
        .from('huespedes')
        .select('nombre, apellido, email, telefono, doc_numero, nacionalidad, notas, puntos, anonimizado')
        .eq('id', id)
        .single()
      const fila = data as {
        nombre: string
        apellido: string
        email: string | null
        telefono: string | null
        doc_numero: string
        nacionalidad: string | null
        notas: string
        puntos: number
        anonimizado: boolean
      }
      expect(fila.email).toBeNull()
      expect(fila.telefono).toBeNull()
      expect(fila.doc_numero).toBe('')
      expect(fila.nacionalidad).toBeNull()
      expect(fila.notas).toBe('')
      expect(fila.anonimizado).toBe(true)
      // Lo que no es un dato personal identificable queda igual: no se
      // castiga la fidelidad del huésped por ejercer su derecho.
      expect(fila.puntos).toBe(42)

      // La reserva sigue intacta, atada al mismo id.
      const { data: reservaActual } = await ctx.db.from('reservas').select('huesped_id').eq('id', reservaId).single()
      expect((reservaActual as { huesped_id: string }).huesped_id).toBe(id)
    })

    it('se bloquea si tiene una reserva que ocupa inventario', async () => {
      const id = await crearHuesped({ email: 'activo@ejemplo.com' })
      const { data: reserva } = await ctx.db
        .from('reservas')
        .insert({ huesped_id: id, estado: 'confirmada', total: 150 })
        .select('id')
        .single()
      ctx.aBorrar.push({ tabla: 'reservas', id: (reserva as { id: string }).id })

      const destino = await destinoDe(() => anonimizarHuesped(formulario({ huesped_id: id })))
      expect(destino).toBe(`/panel/huespedes/${id}?error=anonimizar_activa`)

      const { data } = await ctx.db.from('huespedes').select('email, anonimizado').eq('id', id).single()
      const fila = data as { email: string | null; anonimizado: boolean }
      expect(fila.email, 'no se tiene que haber tocado').toBe('activo@ejemplo.com')
      expect(fila.anonimizado).toBe(false)
    })
  })
})
