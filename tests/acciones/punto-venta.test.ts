import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../db'
import { nuevoContexto, limpiar, usarSesion, type Contexto } from './entorno'

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

/**
 * `cerrarComanda` y el descuento de stock.
 *
 * ── El bug que este test impide que vuelva ──────────────────────────────────
 *
 * El stock lo descuenta el trigger `consumos_descuenta_stock` (migración 0015),
 * que corre `after insert on consumos`. Pero `cerrarComanda` arrastraba además un
 * bucle que **volvía a descontarlo a mano**, heredado de cuando el trigger no
 * funcionaba con sesión de recepción (lo arregló la 0064 poniéndolo
 * `security definer`; el parche quedó).
 *
 * El resultado dependía del rol, que es lo que lo hizo invisible:
 *
 * · **admin/gerencia** → RLS permitía el `update` manual → el stock bajaba **el doble**.
 * · **recepción** → RLS lo bloqueaba → bajaba una sola vez, correcto por accidente.
 *
 * `tests/stock-descuento.test.ts` prueba el trigger insertando en `consumos`
 * **como recepción**, o sea justo el camino que enmascaraba el defecto. Por eso
 * este test corre la **acción completa** y con sesión **admin**: el andamiaje de
 * `tests/acciones/` usa `service_role`, así que el `update` manual no encontraba
 * ninguna política que lo frenara — exactamente el caso del panel real.
 */
describe.skipIf(!hayDB)('Server Actions · punto de venta', () => {
  let ctx: Contexto
  let reservaId = ''
  let productoId = ''
  let servicioId = ''
  type Acciones = typeof import('@/app/panel/punto-venta/actions')
  let cerrarComanda: Acciones['cerrarComanda']

  const STOCK_INICIAL = 50

  beforeAll(async () => {
    ctx = nuevoContexto()
    usarSesion({ rol: 'admin' })
    cerrarComanda = (await import('@/app/panel/punto-venta/actions')).cerrarComanda

    // `consumos.cargado_por` tiene FK contra `perfiles`, así que el userId de
    // fantasía del andamiaje no entra. Se toma uno real, como hace
    // `tests/acciones/reservas.test.ts`.
    const { data: perfil } = await ctx.db.from('perfiles').select('id').limit(1).maybeSingle()
    if (!perfil) {
      throw new Error(
        'No hay ningún perfil en la base. `npx supabase db reset` borra los usuarios ' +
          'de auth: corré `npm run seed:usuarios` antes de este test.',
      )
    }
    usarSesion({ userId: (perfil as { id: string }).id })

    const { data: unidad } = await ctx.db
      .from('unidades')
      .select('id, tipo_unidad_id')
      .limit(1)
      .single()
    const u = unidad as { id: string; tipo_unidad_id: string }

    const { data: h } = await ctx.db
      .from('huespedes')
      .insert({ apellido: `Comanda-${ctx.sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single()
    const huespedId = (h as { id: string }).id
    ctx.aBorrar.push({ tabla: 'huespedes', id: huespedId })

    const { data: r, error } = await ctx.db.rpc('crear_reserva', {
      p_huesped_id: huespedId,
      p_unidad_id: u.id,
      p_tipo_unidad_id: u.tipo_unidad_id,
      p_check_in: '2030-05-01',
      p_check_out: '2030-05-03',
      p_huespedes: 1,
      p_precio_noche: 100,
      p_total: 200,
      p_canal: 'directo',
      p_tarifa_tipo: 'rack',
      p_estado: 'in_house',
    })
    if (error) throw new Error(`no se pudo montar la reserva: ${error.message}`)
    reservaId = (r as { id: string }).id
    ctx.aBorrar.push({ tabla: 'reservas', id: reservaId })

    const { data: p } = await ctx.db
      .from('productos_servicios')
      .insert({
        codigo: `PV-${ctx.sufijo}`,
        nombre: `Producto comanda ${ctx.sufijo}`,
        categoria: 'frigobar',
        precio: 10,
        stock: STOCK_INICIAL,
      })
      .select('id')
      .single()
    productoId = (p as { id: string }).id

    const { data: s } = await ctx.db
      .from('productos_servicios')
      .insert({
        codigo: `PVS-${ctx.sufijo}`,
        nombre: `Servicio comanda ${ctx.sufijo}`,
        categoria: 'excursion',
        precio: 80,
        stock: null,
      })
      .select('id')
      .single()
    servicioId = (s as { id: string }).id
  }, 60_000)

  afterAll(async () => {
    await ctx.db.from('consumos').delete().eq('reserva_id', reservaId)
    await limpiar(ctx)
    for (const id of [productoId, servicioId]) {
      if (id) await ctx.db.from('productos_servicios').delete().eq('id', id)
    }
  })

  /** El `FormData` que arma la grilla. `producto_id` es multivaluado. */
  function comandaCon(items: { id: string; cantidad: number }[]): FormData {
    const fd = new FormData()
    fd.set('reserva_id', reservaId)
    fd.set('folio', 'A')
    for (const { id, cantidad } of items) {
      fd.append('producto_id', id)
      fd.set(`cantidad_${id}`, String(cantidad))
    }
    return fd
  }

  async function stockDe(id: string): Promise<number | null> {
    const { data } = await ctx.db
      .from('productos_servicios')
      .select('stock')
      .eq('id', id)
      .single()
    return (data as { stock: number | null }).stock
  }

  it('el stock queda en inicial menos lo cargado', async () => {
    await ctx.db.from('productos_servicios').update({ stock: STOCK_INICIAL }).eq('id', productoId)

    const estado = await cerrarComanda({}, comandaCon([{ id: productoId, cantidad: 3 }]))
    expect(estado.error, `la comanda no se cargó: ${estado.error}`).toBeUndefined()

    expect(await stockDe(productoId)).toBe(STOCK_INICIAL - 3)
  })

  /**
   * El caso que destapa el defecto, y que la versión de una sola línea NO ve.
   *
   * El bucle manual escribía `stock_leído_al_empezar - cantidad`. Con una línea eso
   * da **el mismo número** que dejó el trigger, así que el error es invisible. Con
   * dos líneas del mismo producto el trigger descuenta las dos (50−3−3 = 44) y el
   * bucle las pisa con su lectura vieja (50−3 = 47): el inventario queda diciendo
   * que hay tres unidades más de las que hay.
   *
   * Es una lectura-modificación-escritura sobre un dato que el trigger ya movió, o
   * sea la misma carrera que dos comandas simultáneas del mismo producto. Esta
   * versión es la determinística.
   */
  it('con el mismo producto en dos líneas no se pierde ningún descuento', async () => {
    await ctx.db.from('productos_servicios').update({ stock: STOCK_INICIAL }).eq('id', productoId)

    const fd = new FormData()
    fd.set('reserva_id', reservaId)
    fd.set('folio', 'A')
    fd.append('producto_id', productoId)
    fd.append('producto_id', productoId)
    fd.set(`cantidad_${productoId}`, '3')

    const estado = await cerrarComanda({}, fd)
    expect(estado.error, `la comanda no se cargó: ${estado.error}`).toBeUndefined()

    expect(
      await stockDe(productoId),
      'el inventario quedó más alto que la realidad: volvió el descuento manual con lectura vieja',
    ).toBe(STOCK_INICIAL - 6)
  })

  it('con varias líneas descuenta cada una una sola vez', async () => {
    await ctx.db.from('productos_servicios').update({ stock: STOCK_INICIAL }).eq('id', productoId)

    const estado = await cerrarComanda(
      {},
      comandaCon([
        { id: productoId, cantidad: 2 },
        { id: servicioId, cantidad: 1 },
      ]),
    )
    expect(estado.error).toBeUndefined()

    expect(await stockDe(productoId)).toBe(STOCK_INICIAL - 2)
    // Un servicio no lleva control de stock: nadie tiene que inventarle uno.
    expect(await stockDe(servicioId), 'se le inventó stock a un servicio').toBeNull()
  })

  it('el consumo queda cargado con su número de comanda', async () => {
    await ctx.db.from('productos_servicios').update({ stock: STOCK_INICIAL }).eq('id', productoId)

    const estado = await cerrarComanda({}, comandaCon([{ id: productoId, cantidad: 1 }]))
    expect(estado.error).toBeUndefined()
    expect(estado.comanda, 'la comanda no devolvió número').toBeTypeOf('number')

    const { data } = await ctx.db
      .from('consumos')
      .select('cantidad, comanda')
      .eq('reserva_id', reservaId)
      .eq('comanda', estado.comanda!)

    expect((data ?? []).length, 'la línea no quedó registrada').toBe(1)
  })
})
