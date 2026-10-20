import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { clienteAnonimo, clienteDePrueba, hayAnon, sufijoUnico } from '../apoyo/db'
import { crearLosCuatroRoles, hayRoles, limpiarUsuarios, type UsuarioDePrueba } from '../apoyo/roles'
import type { Rol } from '@/lib/domain/roles'

/**
 * Las tarifas se actualizan en lote, todas o ninguna (migración 0122).
 *
 * Antes `aplicarPorcentajeTarifario` hacía un `update` por tarifa: si fallaba
 * la séptima de veinte, las seis primeras quedaban con el precio nuevo. Acá se
 * provoca la falla en la SEGUNDA fila del lote y se comprueba que la primera
 * no cambió, que es lo único que distingue «atómico» de «valida antes».
 */
describe.skipIf(!hayRoles)('actualizar_tarifas_en_lote (0122)', () => {
  const db = clienteDePrueba()
  let roles: Record<Rol, UsuarioDePrueba>
  let originales: { id: string; precio_neto: number; precio_rack: number }[]

  async function precios(id: string) {
    const { data, error } = await db
      .from('tarifas')
      .select('precio_neto, precio_rack')
      .eq('id', id)
      .single<{ precio_neto: number; precio_rack: number }>()
    if (error) throw new Error(`No se pudo leer la tarifa ${id}: ${error.message}`)
    return { neto: Number(data.precio_neto), rack: Number(data.precio_rack) }
  }

  beforeAll(async () => {
    roles = await crearLosCuatroRoles(sufijoUnico())
    const { data, error } = await db
      .from('tarifas')
      .select('id, precio_neto, precio_rack')
      .order('id')
      .limit(2)
    if (error) throw new Error(`No se pudieron leer tarifas: ${error.message}`)
    if (!data || data.length < 2) throw new Error('Hacen falta dos tarifas en la base (seed).')
    originales = data
  })

  afterAll(async () => {
    for (const t of originales ?? []) {
      const { error } = await db
        .from('tarifas')
        .update({ precio_neto: t.precio_neto, precio_rack: t.precio_rack })
        .eq('id', t.id)
      if (error) throw new Error(`No se pudo restaurar la tarifa ${t.id}: ${error.message}`)
    }
    await limpiarUsuarios()
  })

  it('gerencia actualiza todo el lote', async () => {
    const [a, b] = originales
    const { data, error } = await roles.gerencia.cliente.rpc('actualizar_tarifas_en_lote', {
      p_cambios: [
        { id: a.id, neto: 111.11, rack: 222.22 },
        { id: b.id, neto: 133.33, rack: 244.44 },
      ],
    })
    expect(error).toBeNull()
    expect(data).toBe(2)
    expect(await precios(a.id)).toEqual({ neto: 111.11, rack: 222.22 })
    expect(await precios(b.id)).toEqual({ neto: 133.33, rack: 244.44 })
  })

  it('si la segunda tarifa no existe, la primera NO cambia', async () => {
    const [a] = originales
    const antes = await precios(a.id)
    const { error } = await roles.gerencia.cliente.rpc('actualizar_tarifas_en_lote', {
      p_cambios: [
        { id: a.id, neto: 1, rack: 2 },
        { id: '00000000-0000-0000-0000-000000000000', neto: 1, rack: 2 },
      ],
    })
    expect(error, 'un lote con una tarifa inexistente se dio por bueno').not.toBeNull()
    expect(await precios(a.id), 'la primera tarifa quedó escrita: el lote no es atómico').toEqual(antes)
  })

  it('si la segunda tarifa tiene el neto por encima del rack, la primera NO cambia', async () => {
    const [a, b] = originales
    const antes = await precios(a.id)
    const { error } = await roles.gerencia.cliente.rpc('actualizar_tarifas_en_lote', {
      p_cambios: [
        { id: a.id, neto: 1, rack: 2 },
        { id: b.id, neto: 500, rack: 100 },
      ],
    })
    expect(error?.code).toBe('22023')
    expect(await precios(a.id)).toEqual(antes)
  })

  for (const rol of ['recepcion', 'housekeeping'] as const) {
    it(`${rol} no puede cambiar tarifas, y se entera (no un «listo» con cero filas)`, async () => {
      const [a] = originales
      const antes = await precios(a.id)
      const { error } = await roles[rol].cliente.rpc('actualizar_tarifas_en_lote', {
        p_cambios: [{ id: a.id, neto: 1, rack: 2 }],
      })
      // RLS filtra el `update` sin lanzar: la función lo convierte en error con FOUND.
      expect(error?.code, `${rol} recibió éxito`).toBe('42501')
      expect(await precios(a.id)).toEqual(antes)
    })
  }

  it.skipIf(!hayAnon)('anon no puede ejecutarla', async () => {
    const [a] = originales
    const { error } = await clienteAnonimo().rpc('actualizar_tarifas_en_lote', {
      p_cambios: [{ id: a.id, neto: 1, rack: 2 }],
    })
    expect(error, 'anon pudo llamar a la función').not.toBeNull()
  })

  it('un lote vacío se rechaza', async () => {
    const { error } = await db.rpc('actualizar_tarifas_en_lote', { p_cambios: [] })
    expect(error?.code).toBe('22023')
  })
})
