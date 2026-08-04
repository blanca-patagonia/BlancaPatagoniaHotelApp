import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../db'
import { nuevoContexto, limpiar, formulario, type Contexto } from './entorno'

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

describe.skipIf(!hayDB)('Server Actions · huéspedes', () => {
  type Acciones = typeof import('@/app/panel/huespedes/actions')
  let ctx: Contexto
  let crearHuesped: Acciones['crearHuesped']
  let actualizarHuesped: Acciones['actualizarHuesped']

  beforeAll(async () => {
    ctx = nuevoContexto()
    const acciones = await import('@/app/panel/huespedes/actions')
    crearHuesped = acciones.crearHuesped
    actualizarHuesped = acciones.actualizarHuesped
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  /** Busca el huésped recién creado para comprobar qué se guardó. */
  async function buscar(apellido: string) {
    const { data } = await ctx.db
      .from('huespedes')
      .select('id, apellido, nombre, email, telefono, nacionalidad, condicion_iva, doc_tipo, doc_numero')
      .eq('apellido', apellido)
      .maybeSingle()
    return data as Record<string, string> | null
  }

  it('persiste TODOS los campos del formulario, no solo el nombre', async () => {
    const apellido = `Alta-${ctx.sufijo}`
    const r = await crearHuesped(
      {},
      formulario({
        apellido,
        nombre: 'Rodrigo',
        doc_tipo: 'DNI',
        doc_numero: '28444555',
        email: `alta-${ctx.sufijo}@ejemplo.com`,
        telefono: '+54 9 2902 555000',
        nacionalidad: 'Argentina',
        condicion_iva: 'consumidor_final',
        notas: 'Prefiere piso alto',
      }),
    )
    expect(r.error).toBeUndefined()

    const h = await buscar(apellido)
    expect(h).not.toBeNull()
    ctx.aBorrar.push({ tabla: 'huespedes', id: h!.id })

    // El punto del test: que ningún campo se pierda en el camino.
    expect(h!.nombre).toBe('Rodrigo')
    expect(h!.email).toBe(`alta-${ctx.sufijo}@ejemplo.com`)
    expect(h!.telefono).toBe('+54 9 2902 555000')
    expect(h!.nacionalidad).toBe('Argentina')
    expect(h!.condicion_iva).toBe('consumidor_final')
  })

  it('RECHAZA un responsable inscripto identificado con DNI', async () => {
    const apellido = `Empresa-${ctx.sufijo}`
    const r = await crearHuesped(
      {},
      formulario({
        apellido,
        nombre: 'Test',
        doc_tipo: 'DNI',
        doc_numero: '12345678',
        condicion_iva: 'responsable_inscripto',
      }),
    )

    expect(r.error).toMatch(/CUIT/i)
    // Y no debe haber quedado nada en la base.
    expect(await buscar(apellido)).toBeNull()
  })

  it('RECHAZA un CUIT con dígito verificador incorrecto', async () => {
    const apellido = `CuitMalo-${ctx.sufijo}`
    const r = await crearHuesped(
      {},
      formulario({
        apellido,
        nombre: 'Test',
        doc_tipo: 'CUIT',
        doc_numero: '30-71234567-8', // el verificador correcto es 1
        condicion_iva: 'responsable_inscripto',
      }),
    )

    expect(r.error).toMatch(/d[ií]gito verificador/i)
    expect(await buscar(apellido)).toBeNull()
  })

  it('acepta un responsable inscripto con CUIT válido', async () => {
    const apellido = `CuitBueno-${ctx.sufijo}`
    const r = await crearHuesped(
      {},
      formulario({
        apellido,
        nombre: 'Test',
        doc_tipo: 'CUIT',
        doc_numero: '30-71234567-1',
        condicion_iva: 'responsable_inscripto',
      }),
    )

    expect(r.error).toBeUndefined()
    const h = await buscar(apellido)
    expect(h).not.toBeNull()
    ctx.aBorrar.push({ tabla: 'huespedes', id: h!.id })
    expect(h!.condicion_iva).toBe('responsable_inscripto')
  })

  it('no permite dos huéspedes con el mismo email', async () => {
    const email = `dup-${ctx.sufijo}@ejemplo.com`
    const primero = `Dup1-${ctx.sufijo}`

    await crearHuesped({}, formulario({ apellido: primero, nombre: 'A', email }))
    const h = await buscar(primero)
    ctx.aBorrar.push({ tabla: 'huespedes', id: h!.id })

    const r = await crearHuesped({}, formulario({ apellido: `Dup2-${ctx.sufijo}`, nombre: 'B', email }))
    expect(r.error).toMatch(/ya hay un hu[eé]sped/i)
  })

  it('la edición actualiza la condición frente al IVA', async () => {
    const apellido = `Edit-${ctx.sufijo}`
    await crearHuesped({}, formulario({ apellido, nombre: 'Test' }))
    const h = await buscar(apellido)
    ctx.aBorrar.push({ tabla: 'huespedes', id: h!.id })

    const r = await actualizarHuesped(
      {},
      formulario({
        huesped_id: h!.id,
        apellido,
        nombre: 'Test',
        doc_tipo: 'CUIT',
        doc_numero: '20-12345678-6',
        condicion_iva: 'responsable_inscripto',
      }),
    )
    expect(r.error).toBeUndefined()

    // De esto depende que se emita factura A en lugar de B.
    const actualizado = await buscar(apellido)
    expect(actualizado!.condicion_iva).toBe('responsable_inscripto')
    expect(actualizado!.doc_tipo).toBe('CUIT')
  })
})
