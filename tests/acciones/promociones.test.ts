import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../apoyo/db'
import { nuevoContexto, limpiar, destinoDe, formulario, type Contexto } from './entorno'

/**
 * ABM de promociones (auditoría QA/UX 2026-10): la tabla, el dominio y
 * `cotizarEstadia` ya soportaban promociones; lo que faltaba era la pantalla
 * de carga. Ver `tests/base-de-datos/crear-reserva-promocion.test.ts` para que el
 * descuento se aplica de verdad al crear una reserva.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('@/lib/auth/session', async () => {
  const { sesionActual } = await import('./entorno')
  return { obtenerSesion: async () => sesionActual() }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../apoyo/db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})

describe.skipIf(!hayDB)('Server Actions · promociones', () => {
  let ctx: Contexto
  type Acciones = typeof import('@/app/(front-gestion)/panel/config/actions')
  let crearPromocion: Acciones['crearPromocion']
  let editarPromocion: Acciones['editarPromocion']
  let alternarActivoPromocion: Acciones['alternarActivoPromocion']

  beforeAll(async () => {
    ctx = nuevoContexto()
    const acciones = await import('@/app/(front-gestion)/panel/config/actions')
    crearPromocion = acciones.crearPromocion
    editarPromocion = acciones.editarPromocion
    alternarActivoPromocion = acciones.alternarActivoPromocion
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  it('crea una promoción porcentual', async () => {
    const codigo = `TEST-PROMO-${ctx.sufijo}`.toUpperCase()
    const destino = await destinoDe(() =>
      crearPromocion(
        {},
        formulario({ codigo, nombre: 'Test', tipo: 'porcentaje', valor: 15, min_noches: 3, anticipacion_dias: 7 }),
      ),
    )
    expect(destino).toBe('/panel/config/promociones?ok=promo_creada')

    const { data } = await ctx.db
      .from('promociones')
      .select('id, tipo, valor, condiciones')
      .eq('codigo', codigo)
      .single()
    const fila = data as { id: string; tipo: string; valor: number; condiciones: Record<string, number> }
    ctx.aBorrar.push({ tabla: 'promociones', id: fila.id })
    expect(fila.tipo).toBe('porcentaje')
    expect(Number(fila.valor)).toBe(15)
    expect(fila.condiciones).toEqual({ min_noches: 3, anticipacion_dias: 7 })
  })

  it('rechaza un porcentaje mayor a 100', async () => {
    const codigo = `TEST-PROMO-MAL-${ctx.sufijo}`.toUpperCase()
    const r = await crearPromocion({}, formulario({ codigo, nombre: 'Test', tipo: 'porcentaje', valor: 150 }))
    // El rechazo vuelve en el estado (el alta tiene su pantalla), con lo cargado.
    expect(r.error).toBe('El valor tiene que ser mayor que cero (y 100 o menos, si es porcentaje).')
    expect(r.valores?.valor).toBe('150')

    const { data } = await ctx.db.from('promociones').select('id').eq('codigo', codigo).maybeSingle()
    expect(data, 'no se tiene que haber creado nada').toBeNull()
  })

  it('rechaza un código repetido', async () => {
    const codigo = `TEST-PROMO-DUP-${ctx.sufijo}`.toUpperCase()
    await crearPromocion({}, formulario({ codigo, nombre: 'Uno', tipo: 'monto', valor: 10 })).catch(() => {})
    const { data } = await ctx.db.from('promociones').select('id').eq('codigo', codigo).single()
    ctx.aBorrar.push({ tabla: 'promociones', id: (data as { id: string }).id })

    const r = await crearPromocion({}, formulario({ codigo, nombre: 'Dos', tipo: 'monto', valor: 20 }))
    expect(r.error).toBe('Ya existe una promoción con ese código.')
  })

  it('edita nombre, valor y condiciones sin tocar el código', async () => {
    const codigo = `TEST-PROMO-EDIT-${ctx.sufijo}`.toUpperCase()
    await crearPromocion({}, formulario({ codigo, nombre: 'Original', tipo: 'monto', valor: 10 })).catch(() => {})
    const { data } = await ctx.db.from('promociones').select('id').eq('codigo', codigo).single()
    const id = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'promociones', id })

    await destinoDe(() =>
      editarPromocion(
        formulario({ promocion_id: id, nombre: 'Editada', tipo: 'porcentaje', valor: 25, min_noches: 2 }),
      ),
    )

    const { data: actual } = await ctx.db
      .from('promociones')
      .select('codigo, nombre, tipo, valor, condiciones')
      .eq('id', id)
      .single()
    const fila = actual as {
      codigo: string
      nombre: string
      tipo: string
      valor: number
      condiciones: Record<string, number>
    }
    expect(fila.codigo).toBe(codigo)
    expect(fila.nombre).toBe('Editada')
    expect(fila.tipo).toBe('porcentaje')
    expect(Number(fila.valor)).toBe(25)
    expect(fila.condiciones).toEqual({ min_noches: 2 })
  })

  it('da de baja y reactiva', async () => {
    const codigo = `TEST-PROMO-BAJA-${ctx.sufijo}`.toUpperCase()
    await crearPromocion({}, formulario({ codigo, nombre: 'Test', tipo: 'monto', valor: 5 })).catch(() => {})
    const { data } = await ctx.db.from('promociones').select('id').eq('codigo', codigo).single()
    const id = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'promociones', id })

    await destinoDe(() => alternarActivoPromocion(formulario({ promocion_id: id, activo: '0' })))
    const { data: baja } = await ctx.db.from('promociones').select('activo').eq('id', id).single()
    expect((baja as { activo: boolean }).activo).toBe(false)

    await destinoDe(() => alternarActivoPromocion(formulario({ promocion_id: id, activo: '1' })))
    const { data: reactivada } = await ctx.db.from('promociones').select('activo').eq('id', id).single()
    expect((reactivada as { activo: boolean }).activo).toBe(true)
  })
})
