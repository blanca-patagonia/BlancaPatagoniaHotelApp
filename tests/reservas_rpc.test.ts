import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Test de integración del alta atómica `crear_reserva` (Fase 2).
 * Verifica que la reserva + estadía se crean en una transacción y que un solape
 * es rechazado SIN dejar una reserva huérfana.
 *
 * Requiere Supabase local. Se salta si no hay credenciales en el entorno.
 */

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hayDB = Boolean(url && serviceKey && !url.includes('placeholder'))

const sufijo = Math.random().toString(36).slice(2, 8)

describe.skipIf(!hayDB)('crear_reserva (alta atómica anti-overbooking)', () => {
  let db: SupabaseClient
  const ids: { tipo?: string; unidad?: string; huesped?: string } = {}

  beforeAll(async () => {
    db = createClient(url!, serviceKey!, { auth: { persistSession: false } })

    const { data: tipo } = await db
      .from('tipos_unidad')
      .insert({ codigo: `TEST-RPC-${sufijo}`, nombre: 'Test RPC', categoria: 'hosteria', capacidad_max: 2 })
      .select('id').single()
    ids.tipo = tipo!.id

    const { data: unidad } = await db
      .from('unidades')
      .insert({ tipo_unidad_id: ids.tipo, nombre: `Test RPC ${sufijo}` })
      .select('id').single()
    ids.unidad = unidad!.id

    const { data: huesped } = await db
      .from('huespedes')
      .insert({ nombre: 'Test', apellido: 'RPC' })
      .select('id').single()
    ids.huesped = huesped!.id
  })

  afterAll(async () => {
    // Borrar reservas del huésped (cascade estadías), luego el resto.
    if (ids.huesped) {
      const { data: rs } = await db.from('reservas').select('id').eq('huesped_id', ids.huesped)
      for (const r of rs ?? []) await db.from('reservas').delete().eq('id', r.id)
    }
    if (ids.unidad) await db.from('unidades').delete().eq('id', ids.unidad)
    if (ids.tipo) await db.from('tipos_unidad').delete().eq('id', ids.tipo)
    if (ids.huesped) await db.from('huespedes').delete().eq('id', ids.huesped)
  })

  function crear(check_in: string, check_out: string) {
    return db.rpc('crear_reserva', {
      p_huesped_id: ids.huesped,
      p_unidad_id: ids.unidad,
      p_tipo_unidad_id: ids.tipo,
      p_check_in: check_in,
      p_check_out: check_out,
      p_huespedes: 2,
      p_precio_noche: 120,
      p_total: 600,
    })
  }

  it('crea la reserva con su código y estadía', async () => {
    const { data, error } = await crear('2031-02-10', '2031-02-15')
    expect(error).toBeNull()
    expect(data?.codigo).toMatch(/^BP-/)
    expect(data?.estado).toBe('confirmada')

    const { count } = await db
      .from('estadias')
      .select('*', { count: 'exact', head: true })
      .eq('reserva_id', data!.id)
    expect(count).toBe(1)
  })

  it('rechaza un solape y no deja reserva huérfana', async () => {
    const { count: antes } = await db
      .from('reservas').select('*', { count: 'exact', head: true }).eq('huesped_id', ids.huesped!)

    const { error } = await crear('2031-02-12', '2031-02-18')
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23P01')

    const { count: despues } = await db
      .from('reservas').select('*', { count: 'exact', head: true }).eq('huesped_id', ids.huesped!)
    expect(despues).toBe(antes) // la transacción se revirtió por completo
  })

  it('acepta un período contiguo (sin solape)', async () => {
    const { error } = await crear('2031-02-15', '2031-02-20')
    expect(error).toBeNull()
  })
})
