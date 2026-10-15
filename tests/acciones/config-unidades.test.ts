import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../db'
import { nuevoContexto, limpiar, destinoDe, formulario, type Contexto } from './entorno'

/**
 * Gestión de tipos de unidad y unidades desde el panel (auditoría QA/UX
 * 2026-10): hasta ahora el único camino para crear o editar un tipo de
 * alojamiento, o para renombrar/dar de baja una unidad, era una migración SQL.
 *
 * Lo más importante que se prueba acá es la guarda de `alternarActivoUnidad`:
 * una unidad con una estadía que ocupa inventario (pendiente, confirmada,
 * pagada o en curso) no se puede dar de baja, porque desaparecería de la
 * grilla con un huésped adentro o por llegar.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  updateTag: () => {},
  // `lib/catalogo/publico.ts` (importado por `config/actions.ts` para
  // `ETIQUETA_CATALOGO`) envuelve sus funciones con esto al cargar el módulo.
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('@/lib/auth/session', async () => {
  const { sesionActual } = await import('./entorno')
  return { obtenerSesion: async () => sesionActual() }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})

describe.skipIf(!hayDB)('Server Actions · tipos de unidad y unidades', () => {
  let ctx: Contexto
  type Acciones = typeof import('@/app/panel/config/actions')
  let crearTipoUnidad: Acciones['crearTipoUnidad']
  let editarTipoUnidad: Acciones['editarTipoUnidad']
  let alternarActivoTipoUnidad: Acciones['alternarActivoTipoUnidad']
  let guardarUbicacionUnidad: Acciones['guardarUbicacionUnidad']
  let alternarActivoUnidad: Acciones['alternarActivoUnidad']

  beforeAll(async () => {
    ctx = nuevoContexto()
    const acciones = await import('@/app/panel/config/actions')
    crearTipoUnidad = acciones.crearTipoUnidad
    editarTipoUnidad = acciones.editarTipoUnidad
    alternarActivoTipoUnidad = acciones.alternarActivoTipoUnidad
    guardarUbicacionUnidad = acciones.guardarUbicacionUnidad
    alternarActivoUnidad = acciones.alternarActivoUnidad
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  it('crea un tipo de alojamiento nuevo', async () => {
    const codigo = `TEST-TIPO-${ctx.sufijo}`.toUpperCase()
    const destino = await destinoDe(() =>
      crearTipoUnidad(
        formulario({ codigo, nombre: 'Test Deluxe', categoria: 'hosteria', capacidad_max: 3, descripcion: 'Con vista' }),
      ),
    )
    expect(destino).toBe('/panel/config/tipos-alojamiento?ok=tipo_creado')

    const { data } = await ctx.db.from('tipos_unidad').select('id, categoria, capacidad_max').eq('codigo', codigo).single()
    const tipo = data as { id: string; categoria: string; capacidad_max: number }
    ctx.aBorrar.push({ tabla: 'tipos_unidad', id: tipo.id })
    expect(tipo.categoria).toBe('hosteria')
    expect(tipo.capacidad_max).toBe(3)
  })

  it('rechaza un código repetido en vez de romper con un error de base', async () => {
    const codigo = `TEST-DUP-${ctx.sufijo}`.toUpperCase()
    await destinoDe(() =>
      crearTipoUnidad(formulario({ codigo, nombre: 'Uno', categoria: 'cabana', capacidad_max: 2 })),
    )
    const { data } = await ctx.db.from('tipos_unidad').select('id').eq('codigo', codigo).single()
    ctx.aBorrar.push({ tabla: 'tipos_unidad', id: (data as { id: string }).id })

    const destino = await destinoDe(() =>
      crearTipoUnidad(formulario({ codigo, nombre: 'Dos', categoria: 'cabana', capacidad_max: 4 })),
    )
    // Lo tecleado vuelve en la URL para repoblar el formulario de alta
    // (auditoría QA/UX 2026-10-14): antes el error lo vaciaba entero.
    const previa = new URLSearchParams({
      alta_codigo: codigo,
      alta_nombre: 'Dos',
      alta_categoria: 'cabana',
      alta_capacidad: '4',
      alta_descripcion: '',
    }).toString()
    expect(destino).toBe(`/panel/config/tipos-alojamiento?error=tipo_codigo_repetido&${previa}`)
  })

  it('edita nombre, descripción y capacidad sin tocar el código', async () => {
    const codigo = `TEST-EDIT-${ctx.sufijo}`.toUpperCase()
    await crearTipoUnidad(formulario({ codigo, nombre: 'Original', categoria: 'hosteria', capacidad_max: 2 })).catch(
      () => {},
    )
    const { data } = await ctx.db.from('tipos_unidad').select('id').eq('codigo', codigo).single()
    const tipoId = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'tipos_unidad', id: tipoId })

    await destinoDe(() =>
      editarTipoUnidad(
        formulario({ tipo_id: tipoId, nombre: 'Editado', descripcion: 'Nueva descripción', capacidad_max: 5 }),
      ),
    )

    const { data: actual } = await ctx.db
      .from('tipos_unidad')
      .select('codigo, nombre, descripcion, capacidad_max')
      .eq('id', tipoId)
      .single()
    const fila = actual as { codigo: string; nombre: string; descripcion: string; capacidad_max: number }
    expect(fila.nombre).toBe('Editado')
    expect(fila.descripcion).toBe('Nueva descripción')
    expect(fila.capacidad_max).toBe(5)
    expect(fila.codigo).toBe(codigo)
  })

  it('da de baja y reactiva un tipo', async () => {
    const codigo = `TEST-BAJA-${ctx.sufijo}`.toUpperCase()
    await crearTipoUnidad(formulario({ codigo, nombre: 'Test', categoria: 'cabana', capacidad_max: 2 })).catch(() => {})
    const { data } = await ctx.db.from('tipos_unidad').select('id').eq('codigo', codigo).single()
    const tipoId = (data as { id: string }).id
    ctx.aBorrar.push({ tabla: 'tipos_unidad', id: tipoId })

    await destinoDe(() => alternarActivoTipoUnidad(formulario({ tipo_id: tipoId, activo: '0' })))
    const { data: bajaData } = await ctx.db.from('tipos_unidad').select('activo').eq('id', tipoId).single()
    expect((bajaData as { activo: boolean }).activo).toBe(false)

    await destinoDe(() => alternarActivoTipoUnidad(formulario({ tipo_id: tipoId, activo: '1' })))
    const { data: reactivadaData } = await ctx.db.from('tipos_unidad').select('activo').eq('id', tipoId).single()
    expect((reactivadaData as { activo: boolean }).activo).toBe(true)
  })

  describe('unidades: renombrar y dar de baja', () => {
    let tipoId: string
    let unidadId: string

    beforeAll(async () => {
      const { data: tipo } = await ctx.db
        .from('tipos_unidad')
        .insert({ codigo: `TEST-UNI-TIPO-${ctx.sufijo}`, nombre: 'Test', categoria: 'hosteria', capacidad_max: 2 })
        .select('id')
        .single()
      tipoId = (tipo as { id: string }).id
      ctx.aBorrar.push({ tabla: 'tipos_unidad', id: tipoId })

      const { data: unidad } = await ctx.db
        .from('unidades')
        .insert({ tipo_unidad_id: tipoId, nombre: `Sin nombre ${ctx.sufijo}` })
        .select('id')
        .single()
      unidadId = (unidad as { id: string }).id
      ctx.aBorrar.push({ tabla: 'unidades', id: unidadId })
    })

    it('exige un nombre: no deja guardar la ubicación con el campo vacío', async () => {
      const destino = await destinoDe(() =>
        guardarUbicacionUnidad(formulario({ unidad_id: unidadId, nombre: '', bloque: 'Hostería', piso: 'PB', orden: 1 })),
      )
      expect(destino).toBe('/panel/config/ubicaciones?error=unidad_nombre')
    })

    it('renombra la unidad junto con su ubicación, en el mismo envío', async () => {
      const destino = await destinoDe(() =>
        guardarUbicacionUnidad(
          formulario({ unidad_id: unidadId, nombre: 'Agassiz', bloque: 'Hostería', piso: 'PB', orden: 3 }),
        ),
      )
      expect(destino).toBe('/panel/config/ubicaciones?ok=ubicacion')

      const { data } = await ctx.db.from('unidades').select('nombre, piso, orden').eq('id', unidadId).single()
      const fila = data as { nombre: string; piso: string; orden: number }
      expect(fila.nombre).toBe('Agassiz')
      expect(fila.piso).toBe('PB')
      expect(fila.orden).toBe(3)
    })

    it('da de baja una unidad libre sin problema', async () => {
      const destino = await destinoDe(() => alternarActivoUnidad(formulario({ unidad_id: unidadId, activo: '0' })))
      expect(destino).toBe('/panel/config/ubicaciones?ok=unidad_dada_de_baja')

      const { data } = await ctx.db.from('unidades').select('activo').eq('id', unidadId).single()
      expect((data as { activo: boolean }).activo).toBe(false)

      // La reactivación no tiene guarda: siempre se puede volver a ofrecer.
      await destinoDe(() => alternarActivoUnidad(formulario({ unidad_id: unidadId, activo: '1' })))
      const { data: reactivada } = await ctx.db.from('unidades').select('activo').eq('id', unidadId).single()
      expect((reactivada as { activo: boolean }).activo).toBe(true)
    })

    it('NO deja dar de baja una unidad con una estadía que ocupa inventario', async () => {
      const { data: huesped } = await ctx.db
        .from('huespedes')
        .insert({ nombre: 'Test', apellido: `Unidad ${ctx.sufijo}` })
        .select('id')
        .single()
      const huespedId = (huesped as { id: string }).id
      ctx.aBorrar.push({ tabla: 'huespedes', id: huespedId })

      const { data: reserva } = await ctx.db
        .from('reservas')
        .insert({ huesped_id: huespedId, estado: 'confirmada' })
        .select('id')
        .single()
      const reservaId = (reserva as { id: string }).id
      ctx.aBorrar.push({ tabla: 'reservas', id: reservaId })

      const { data: estadia } = await ctx.db
        .from('estadias')
        .insert({
          reserva_id: reservaId,
          unidad_id: unidadId,
          tipo_unidad_id: tipoId,
          periodo: '[2031-01-10,2031-01-15)',
          estado: 'confirmada',
        })
        .select('id')
        .single()
      ctx.aBorrar.push({ tabla: 'estadias', id: (estadia as { id: string }).id })

      const destino = await destinoDe(() => alternarActivoUnidad(formulario({ unidad_id: unidadId, activo: '0' })))
      expect(destino).toBe('/panel/config/ubicaciones?error=unidad_ocupada')

      const { data } = await ctx.db.from('unidades').select('activo').eq('id', unidadId).single()
      expect((data as { activo: boolean }).activo, 'no se tiene que haber tocado').toBe(true)
    })
  })
})
