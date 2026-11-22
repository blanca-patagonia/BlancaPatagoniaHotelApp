import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../apoyo/db'
import { nuevoContexto, limpiar, destinoDe, sesionActual, type Contexto } from './entorno'

/**
 * Repartir el trabajo de housekeeping (vista «Por responsable»).
 *
 * Al probar la demo, el docente no entendió esa vista. Dos causas, las dos
 * cubiertas acá: asignar devolvía siempre a «Por unidad» (se perdía la pantalla
 * en la que se estaba repartiendo), y repartir 37 habitaciones eran 37 clics.
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
    obtenerSesion: async () => sesionActual(),
    requerirSesion: async () => sesionActual(),
    requerirAcceso: async () => sesionActual(),
  }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../apoyo/db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})

/** Un FormData con campos repetidos (`unidad_id` varias veces). */
function formularioCon(pares: [string, string][]): FormData {
  const f = new FormData()
  for (const [k, v] of pares) f.append(k, v)
  return f
}

describe.skipIf(!hayDB)('Server Actions · housekeeping: repartir el trabajo', () => {
  let ctx: Contexto
  let acciones: typeof import('@/app/(front-gestion)/panel/housekeeping/actions')
  const unidades: string[] = []
  let tipoId = ''
  let responsable = ''

  beforeAll(async () => {
    ctx = nuevoContexto()
    acciones = await import('@/app/(front-gestion)/panel/housekeeping/actions')

    const { data: perfil } = await ctx.db.from('perfiles').select('id').limit(1).maybeSingle()
    if (!perfil) throw new Error('No hay perfiles: correr `npm run seed:usuarios` después del reset.')
    responsable = (perfil as { id: string }).id
    sesionActual().userId = responsable

    const sufijo = Math.random().toString(36).slice(2, 8)
    const { data: tipo, error: eTipo } = await ctx.db
      .from('tipos_unidad')
      .insert({ codigo: `HK-${sufijo}`, nombre: 'Test reparto', categoria: 'hosteria', capacidad_max: 2 })
      .select('id')
      .single()
    if (eTipo) throw new Error(eTipo.message)
    tipoId = (tipo as { id: string }).id
    for (const n of ['A', 'B', 'C']) {
      const { data: u, error } = await ctx.db
        .from('unidades')
        .insert({ tipo_unidad_id: tipoId, nombre: `Reparto ${n} ${sufijo}` })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      unidades.push((u as { id: string }).id)
    }
  })

  afterAll(async () => {
    for (const u of unidades) await ctx.db.from('unidades').delete().eq('id', u)
    if (tipoId) await ctx.db.from('tipos_unidad').delete().eq('id', tipoId)
    await limpiar(ctx)
  })

  async function asignadaA(id: string): Promise<string | null> {
    const { data } = await ctx.db.from('unidades').select('asignada_a').eq('id', id).single()
    return (data as { asignada_a: string | null }).asignada_a
  }

  it('asigna varias habitaciones de una vez y vuelve a «Por responsable»', async () => {
    const destino = await destinoDe(() =>
      acciones.asignarVarias(
        formularioCon([
          ['unidad_id', unidades[0]],
          ['unidad_id', unidades[1]],
          ['mucama_id', responsable],
        ]),
      ),
    )
    expect(destino).toBe('/panel/housekeeping?vista=mucama&ok=asignadas&n=2')
    expect(await asignadaA(unidades[0])).toBe(responsable)
    expect(await asignadaA(unidades[1])).toBe(responsable)
    // La que no se marcó, no se toca.
    expect(await asignadaA(unidades[2])).toBeNull()
  })

  it('«Nadie» deja las marcadas sin asignar', async () => {
    await destinoDe(() =>
      acciones.asignarVarias(formularioCon([['unidad_id', unidades[0]], ['mucama_id', '']])),
    )
    expect(await asignadaA(unidades[0])).toBeNull()
  })

  it('sin ninguna marcada no escribe y lo dice', async () => {
    const destino = await destinoDe(() => acciones.asignarVarias(formularioCon([['mucama_id', responsable]])))
    expect(destino).toBe('/panel/housekeeping?vista=mucama&error=sin_marcar')
  })

  it('la asignación de a una también vuelve a la vista desde la que se hizo', async () => {
    const destino = await destinoDe(() =>
      acciones.asignarMucama(
        formularioCon([
          ['unidad_id', unidades[2]],
          ['mucama_id', responsable],
          ['vista', 'mucama'],
        ]),
      ),
    )
    expect(destino).toBe('/panel/housekeeping?vista=mucama')
    expect(await asignadaA(unidades[2])).toBe(responsable)
  })
})
