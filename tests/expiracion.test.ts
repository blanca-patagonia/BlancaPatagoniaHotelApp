import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'

/**
 * Test de integración de `expirar_reservas_pendientes`: cancela reservas pendientes
 * sin seña con antigüedad > N días, y respeta las que tienen seña. Requiere DB local.
 */


const sufijo = sufijoUnico()
const HACE_10_DIAS = '2010-01-01T00:00:00Z' // muy antigua → siempre expira con p_dias=5

describe.skipIf(!hayDB)('expirar_reservas_pendientes', () => {
  let db: SupabaseClient
  const ids: { tipo?: string; unidad?: string; huesped?: string; sinSenia?: string; conSenia?: string } = {}

  async function crearReservaPendiente(unidadId: string, periodo: string): Promise<string> {
    const { data: r } = await db
      .from('reservas')
      .insert({ huesped_id: ids.huesped, estado: 'pendiente', canal: 'web', creada_en: HACE_10_DIAS })
      .select('id')
      .single()
    await db.from('estadias').insert({
      reserva_id: r!.id,
      unidad_id: unidadId,
      tipo_unidad_id: ids.tipo,
      periodo,
      estado: 'pendiente',
    })
    return r!.id as string
  }

  beforeAll(async () => {
    db = clienteDePrueba()
    const { data: tipo } = await db
      .from('tipos_unidad')
      .insert({ codigo: `TEST-EXP-${sufijo}`, nombre: 'Test Exp', categoria: 'hosteria', capacidad_max: 2 })
      .select('id').single()
    ids.tipo = tipo!.id
    const { data: u1 } = await db.from('unidades').insert({ tipo_unidad_id: ids.tipo, nombre: `Exp A ${sufijo}` }).select('id').single()
    const { data: u2 } = await db.from('unidades').insert({ tipo_unidad_id: ids.tipo, nombre: `Exp B ${sufijo}` }).select('id').single()
    ids.unidad = u1!.id
    const { data: h } = await db.from('huespedes').insert({ nombre: 'Test', apellido: 'Exp' }).select('id').single()
    ids.huesped = h!.id

    ids.sinSenia = await crearReservaPendiente(u1!.id, '[2035-01-10,2035-01-13)')
    ids.conSenia = await crearReservaPendiente(u2!.id, '[2035-02-10,2035-02-13)')
    // La segunda tiene una seña aprobada → no debe expirar.
    await db.from('pagos').insert({ reserva_id: ids.conSenia, medio: 'transferencia', tipo: 'senia', monto: 100, estado: 'aprobado' })
  })

  afterAll(async () => {
    for (const id of [ids.sinSenia, ids.conSenia]) if (id) await db.from('reservas').delete().eq('id', id)
    if (ids.unidad) await db.from('unidades').delete().eq('tipo_unidad_id', ids.tipo)
    if (ids.tipo) await db.from('tipos_unidad').delete().eq('id', ids.tipo)
    if (ids.huesped) await db.from('huespedes').delete().eq('id', ids.huesped)
  })

  it('cancela la pendiente sin seña y respeta la que tiene seña', async () => {
    const { error } = await db.rpc('expirar_reservas_pendientes', { p_dias: 5 })
    expect(error).toBeNull()

    const { data: sin } = await db.from('reservas').select('estado').eq('id', ids.sinSenia!).single()
    const { data: con } = await db.from('reservas').select('estado').eq('id', ids.conSenia!).single()
    expect(sin!.estado).toBe('cancelada')
    expect(con!.estado).toBe('pendiente')
  })
})
