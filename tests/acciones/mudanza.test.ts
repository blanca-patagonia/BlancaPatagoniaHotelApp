import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../db'
import {
  nuevoContexto,
  crearHuespedDePrueba,
  limpiar,
  destinoDe,
  formulario,
  type Contexto,
} from './entorno'

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

describe.skipIf(!hayDB)('Server Actions · cambio de unidad', () => {
  type Acciones = typeof import('@/app/panel/reservas/actions')
  let ctx: Contexto
  let cambiarUnidad: Acciones['cambiarUnidadReserva']
  /** Dos unidades del MISMO tipo: así la mudanza no dispara la recotización. */
  let unidadA: { id: string; tipo_unidad_id: string }
  let unidadB: { id: string; tipo_unidad_id: string }

  beforeAll(async () => {
    ctx = nuevoContexto()
    cambiarUnidad = (await import('@/app/panel/reservas/actions')).cambiarUnidadReserva

    const { data } = await ctx.db
      .from('unidades')
      .select('id, tipo_unidad_id')
      .eq('activo', true)
      .order('nombre')

    const unidades = (data ?? []) as { id: string; tipo_unidad_id: string }[]
    const porTipo = new Map<string, typeof unidades>()
    for (const u of unidades) {
      porTipo.set(u.tipo_unidad_id, [...(porTipo.get(u.tipo_unidad_id) ?? []), u])
    }
    const par = [...porTipo.values()].find((us) => us.length >= 2)
    if (!par) throw new Error('El seed necesita al menos dos unidades del mismo tipo.')
    ;[unidadA, unidadB] = par
  })

  afterAll(async () => {
    await limpiar(ctx)
    // Las unidades son del seed, no del test: se dejan como estaban.
    await ctx.db
      .from('unidades')
      .update({ estado: 'limpia' })
      .in('id', [unidadA.id, unidadB.id])
  })

  /**
   * Crea una reserva con su estadía directamente en la base. Se evita el alta
   * normal a propósito: acá interesa la mudanza, no la cotización.
   */
  async function reservaEn(
    unidad: { id: string; tipo_unidad_id: string },
    estado: string,
    desde: string,
    hasta: string,
  ) {
    const huespedId = await crearHuespedDePrueba(ctx)
    const { data: r } = await ctx.db
      .from('reservas')
      .insert({ huesped_id: huespedId, estado, total: 400 })
      .select('id')
      .single()
    const reservaId = (r as { id: string }).id
    ctx.aBorrar.push({ tabla: 'reservas', id: reservaId })

    // La estadía se borra en cascada con la reserva, así que no se registra.
    const { error } = await ctx.db.from('estadias').insert({
      reserva_id: reservaId,
      unidad_id: unidad.id,
      tipo_unidad_id: unidad.tipo_unidad_id,
      periodo: `[${desde},${hasta})`,
      estado,
      precio_noche: 100,
      huespedes: 1,
    })
    if (error) throw new Error(`No se pudo preparar la estadía: ${error.message}`)
    return reservaId
  }

  async function unidadDe(reservaId: string) {
    const { data } = await ctx.db
      .from('estadias')
      .select('unidad_id, tipo_unidad_id')
      .eq('reserva_id', reservaId)
      .single()
    return data as { unidad_id: string; tipo_unidad_id: string }
  }

  async function estadoHk(unidadId: string) {
    const { data } = await ctx.db.from('unidades').select('estado').eq('id', unidadId).single()
    return (data as { estado: string }).estado
  }

  it('mueve la estadía a la unidad de destino', async () => {
    const id = await reservaEn(unidadA, 'confirmada', '2027-03-01', '2027-03-05')

    const destino = await destinoDe(() =>
      cambiarUnidad(formulario({ reserva_id: id, unidad_destino: unidadB.id })),
    )

    expect(destino).toBe(`/panel/reservas/${id}?ok=mudanza`)
    expect((await unidadDe(id)).unidad_id).toBe(unidadB.id)
  })

  it('deja SUCIA la unidad liberada si el huésped ya estaba alojado', async () => {
    await ctx.db.from('unidades').update({ estado: 'limpia' }).eq('id', unidadA.id)
    const id = await reservaEn(unidadA, 'in_house', '2027-04-01', '2027-04-04')

    await destinoDe(() =>
      cambiarUnidad(formulario({ reserva_id: id, unidad_destino: unidadB.id })),
    )

    // Es el punto de hacerlo en la base: mudanza y limpieza van juntas.
    expect(await estadoHk(unidadA.id)).toBe('sucia')
  })

  it('NO le inventa trabajo a mucamas si todavía no hizo el check-in', async () => {
    await ctx.db.from('unidades').update({ estado: 'limpia' }).eq('id', unidadA.id)
    const id = await reservaEn(unidadA, 'confirmada', '2027-05-01', '2027-05-03')

    await destinoDe(() =>
      cambiarUnidad(formulario({ reserva_id: id, unidad_destino: unidadB.id })),
    )

    expect(await estadoHk(unidadA.id)).toBe('limpia')
  })

  it('RECHAZA mudar a una unidad ocupada en esas fechas', async () => {
    // Dos reservas que se pisan en el tiempo, cada una en su unidad.
    const enA = await reservaEn(unidadA, 'confirmada', '2027-06-10', '2027-06-15')
    const enB = await reservaEn(unidadB, 'confirmada', '2027-06-12', '2027-06-18')

    const destino = await destinoDe(() =>
      cambiarUnidad(formulario({ reserva_id: enA, unidad_destino: unidadB.id })),
    )

    // Lo rechaza la restricción de exclusión (23P01), no la aplicación.
    expect(destino).toBe(`/panel/reservas/${enA}?error=ocupada`)
    // Y la estadía NO se movió.
    expect((await unidadDe(enA)).unidad_id).toBe(unidadA.id)
    expect((await unidadDe(enB)).unidad_id).toBe(unidadB.id)
  })

  it('RECHAZA mudar una reserva que ya hizo el check-out', async () => {
    const id = await reservaEn(unidadA, 'checkout', '2027-07-01', '2027-07-03')

    const destino = await destinoDe(() =>
      cambiarUnidad(formulario({ reserva_id: id, unidad_destino: unidadB.id })),
    )

    expect(destino).toBe(`/panel/reservas/${id}?error=finalizada`)
    expect((await unidadDe(id)).unidad_id).toBe(unidadA.id)
  })

  it('RECHAZA mudar a la misma unidad', async () => {
    const id = await reservaEn(unidadA, 'confirmada', '2027-08-01', '2027-08-03')

    const destino = await destinoDe(() =>
      cambiarUnidad(formulario({ reserva_id: id, unidad_destino: unidadA.id })),
    )

    expect(destino).toBe(`/panel/reservas/${id}?error=misma_unidad`)
  })

  it('deja la mudanza registrada en la auditoría', async () => {
    const id = await reservaEn(unidadA, 'confirmada', '2027-09-01', '2027-09-04')
    const { data: previa } = await ctx.db
      .from('estadias')
      .select('id')
      .eq('reserva_id', id)
      .single()
    const estadiaId = (previa as { id: string }).id

    await destinoDe(() =>
      cambiarUnidad(formulario({ reserva_id: id, unidad_destino: unidadB.id })),
    )

    const { data } = await ctx.db
      .from('auditoria')
      .select('accion, datos_previos, datos_nuevos')
      .eq('tabla', 'estadias')
      .eq('registro_id', estadiaId)
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle()

    expect(data, 'la mudanza no quedó auditada').not.toBeNull()
    const fila = data as {
      accion: string
      datos_previos: { unidad_id: string }
      datos_nuevos: { unidad_id: string }
    }
    expect(fila.accion).toBe('UPDATE')
    expect(fila.datos_previos.unidad_id).toBe(unidadA.id)
    expect(fila.datos_nuevos.unidad_id).toBe(unidadB.id)
  })
})
