import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { clienteDePrueba, hayDB, sufijoUnico } from './db'
import { crearUsuarioConRol, hayRoles, limpiarUsuarios, type UsuarioDePrueba } from './roles'

/**
 * El descuento de stock al cargar un consumo.
 *
 * ── El bug que este test impide que vuelva ──────────────────────────────────
 *
 * `descontar_stock_consumo()` (migración 0015) se declaró **sin**
 * `security definer`, así que corría con los privilegios de quien insertaba el
 * consumo. Su `update` sobre `productos_servicios` chocaba con la política
 * `admin/gerencia gestionan`, RLS filtraba la fila, el update afectaba **cero
 * filas** y Postgres lo daba por exitoso.
 *
 * Resultado con una sesión de recepción —el rol que carga consumos todos los
 * días—: el consumo se cobraba y el stock quedaba igual. **Sin un solo error.**
 *
 * Por eso este test corre como RECEPCIÓN y no con `service_role`: con el cliente
 * privilegiado el bug no se reproduce, porque saltea RLS. Un test que no puede
 * ver el bug no protege de él.
 */
describe.skipIf(!hayDB || !hayRoles)('descuento de stock al cargar un consumo', () => {
  const admin = clienteDePrueba()
  const sufijo = sufijoUnico()
  let recepcion: UsuarioDePrueba
  let reservaId = ''
  let huespedId = ''
  let productoId = ''

  beforeAll(async () => {
    recepcion = await crearUsuarioConRol('recepcion', sufijo)

    const { data: unidad } = await admin
      .from('unidades')
      .select('id, tipo_unidad_id')
      .limit(1)
      .single()
    const u = unidad as { id: string; tipo_unidad_id: string }

    const { data: h } = await admin
      .from('huespedes')
      .insert({ apellido: `Stock-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single()
    huespedId = (h as { id: string }).id

    const { data: r, error } = await admin.rpc('crear_reserva', {
      p_huesped_id: huespedId,
      p_unidad_id: u.id,
      p_tipo_unidad_id: u.tipo_unidad_id,
      p_check_in: '2030-03-01',
      p_check_out: '2030-03-03',
      p_huespedes: 1,
      p_precio_noche: 100,
      p_total: 200,
      p_canal: 'directo',
      p_tarifa_tipo: 'rack',
      p_estado: 'in_house',
    })
    if (error) throw new Error(`no se pudo montar la reserva: ${error.message}`)
    reservaId = (r as { id: string }).id

    const { data: p } = await admin
      .from('productos_servicios')
      .insert({
        codigo: `STK-${sufijo}`,
        nombre: `Producto stock ${sufijo}`,
        categoria: 'frigobar',
        precio: 10,
        stock: 50,
      })
      .select('id')
      .single()
    productoId = (p as { id: string }).id
  }, 60_000)

  afterAll(async () => {
    await admin.from('reservas').delete().eq('id', reservaId)
    await admin.from('huespedes').delete().eq('id', huespedId)
    await admin.from('productos_servicios').delete().eq('id', productoId)
    await limpiarUsuarios()
  })

  /** Stock actual, leído con el cliente privilegiado. */
  async function stock(): Promise<number | null> {
    const { data } = await admin
      .from('productos_servicios')
      .select('stock')
      .eq('id', productoId)
      .single()
    return (data as { stock: number | null }).stock
  }

  it('recepción carga un consumo y el stock BAJA de verdad', async () => {
    expect(await stock()).toBe(50)

    const { error } = await recepcion.cliente.from('consumos').insert({
      reserva_id: reservaId,
      producto_id: productoId,
      cantidad: 3,
      precio_unitario: 10,
    })
    expect(error, 'recepción no pudo cargar el consumo').toBeNull()

    expect(
      await stock(),
      'el consumo se cobró pero el stock no bajó: el trigger volvió a ser SECURITY INVOKER',
    ).toBe(47)
  })

  it('el descuento no baja de cero aunque se cargue de más', async () => {
    await admin.from('productos_servicios').update({ stock: 2 }).eq('id', productoId)

    const { error } = await recepcion.cliente.from('consumos').insert({
      reserva_id: reservaId,
      producto_id: productoId,
      cantidad: 10,
      precio_unitario: 10,
    })
    expect(error).toBeNull()
    expect(await stock(), 'el stock quedó negativo').toBe(0)
  })

  it('un producto sin control de stock (servicios) no se toca', async () => {
    const { data: p } = await admin
      .from('productos_servicios')
      .insert({
        codigo: `SRV-${sufijo}`,
        nombre: `Servicio ${sufijo}`,
        categoria: 'excursion',
        precio: 80,
        stock: null,
      })
      .select('id')
      .single()
    const servicioId = (p as { id: string }).id

    const { error } = await recepcion.cliente.from('consumos').insert({
      reserva_id: reservaId,
      producto_id: servicioId,
      cantidad: 2,
      precio_unitario: 80,
    })
    expect(error).toBeNull()

    const { data } = await admin
      .from('productos_servicios')
      .select('stock')
      .eq('id', servicioId)
      .single()
    expect((data as { stock: number | null }).stock, 'se le inventó stock a un servicio').toBeNull()

    await admin.from('productos_servicios').delete().eq('id', servicioId)
  })
})
