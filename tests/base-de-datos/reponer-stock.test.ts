import { describe, it, expect, afterAll } from 'vitest'
import { clienteDePrueba, hayDB, sufijoUnico } from '../apoyo/db'

/**
 * `reponer_stock` (0116): suma en un solo UPDATE. Antes la acción leía el
 * stock y escribía «leído + cantidad», y un consumo simultáneo quedaba pisado.
 */
describe.skipIf(!hayDB)('reponer_stock', () => {
  const db = clienteDePrueba()
  const sufijo = sufijoUnico()
  const ids: string[] = []

  async function producto(stock: number | null) {
    const { data, error } = await db
      .from('productos_servicios')
      .insert({ codigo: `REP-${sufijo}-${ids.length}`, nombre: 'Agua test', categoria: 'otro', precio: 1, stock })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    ids.push(data.id as string)
    return data.id as string
  }

  afterAll(async () => {
    for (const id of ids) await db.from('productos_servicios').delete().eq('id', id)
  })

  it('suma sobre el valor ACTUAL de la base y devuelve el nuevo', async () => {
    const id = await producto(5)
    // Un consumo descontó entre medio: la reposición tiene que sumar sobre 3, no sobre 5.
    await db.from('productos_servicios').update({ stock: 3 }).eq('id', id)
    const { data, error } = await db.rpc('reponer_stock', { p_producto_id: id, p_cantidad: 10 })
    expect(error).toBeNull()
    expect(data).toBe(13)
  })

  it('un servicio sin inventario devuelve null y no cambia nada', async () => {
    const id = await producto(null)
    const { data, error } = await db.rpc('reponer_stock', { p_producto_id: id, p_cantidad: 4 })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('una cantidad no positiva se rechaza', async () => {
    const id = await producto(1)
    const { error } = await db.rpc('reponer_stock', { p_producto_id: id, p_cantidad: 0 })
    expect(error).not.toBeNull()
  })
})
