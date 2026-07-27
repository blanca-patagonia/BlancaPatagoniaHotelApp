import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Test de integración del motor anti-overbooking (ADR 0002).
 *
 * Verifica, contra una base Postgres real, que la restricción de exclusión de
 * `estadias` impide dos estadías activas solapadas sobre la misma unidad, y que
 * las cancelaciones liberan el inventario.
 *
 * Requiere Supabase local levantado. Se salta si no hay credenciales en el
 * entorno. Ejecutar con:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test
 * (los valores los imprime `supabase status`).
 */

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hayDB = Boolean(url && serviceKey && !url.includes('placeholder'))

const sufijo = Math.random().toString(36).slice(2, 8)
const PERIODO = (a: string, b: string) => `[${a},${b})`

describe.skipIf(!hayDB)('anti-overbooking (restricción de exclusión)', () => {
  let db: SupabaseClient
  const ids: { tipo?: string; unidad?: string; huesped?: string; reserva?: string } = {}

  beforeAll(async () => {
    db = createClient(url!, serviceKey!, { auth: { persistSession: false } })

    const { data: tipo } = await db
      .from('tipos_unidad')
      .insert({ codigo: `TEST-OB-${sufijo}`, nombre: 'Test OB', categoria: 'hosteria', capacidad_max: 2 })
      .select('id')
      .single()
    ids.tipo = tipo!.id

    const { data: unidad } = await db
      .from('unidades')
      .insert({ tipo_unidad_id: ids.tipo, nombre: `Test OB ${sufijo}` })
      .select('id')
      .single()
    ids.unidad = unidad!.id

    const { data: huesped } = await db
      .from('huespedes')
      .insert({ nombre: 'Test', apellido: 'Overbooking' })
      .select('id')
      .single()
    ids.huesped = huesped!.id

    const { data: reserva } = await db
      .from('reservas')
      .insert({ huesped_id: ids.huesped, estado: 'confirmada' })
      .select('id')
      .single()
    ids.reserva = reserva!.id
  })

  afterAll(async () => {
    if (ids.reserva) await db.from('reservas').delete().eq('id', ids.reserva)
    if (ids.unidad) await db.from('unidades').delete().eq('id', ids.unidad)
    if (ids.tipo) await db.from('tipos_unidad').delete().eq('id', ids.tipo)
    if (ids.huesped) await db.from('huespedes').delete().eq('id', ids.huesped)
  })

  async function insertarEstadia(periodo: string, estado = 'confirmada') {
    return db.from('estadias').insert({
      reserva_id: ids.reserva,
      unidad_id: ids.unidad,
      tipo_unidad_id: ids.tipo,
      periodo,
      estado,
    })
  }

  it('acepta la primera estadía', async () => {
    const { error } = await insertarEstadia(PERIODO('2030-01-10', '2030-01-15'))
    expect(error).toBeNull()
  })

  it('rechaza una estadía activa que solapa la misma unidad', async () => {
    const { error } = await insertarEstadia(PERIODO('2030-01-12', '2030-01-18'))
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23P01') // exclusion_violation
  })

  it('acepta una estadía contigua (check-out = check-in)', async () => {
    const { error } = await insertarEstadia(PERIODO('2030-01-15', '2030-01-20'))
    expect(error).toBeNull()
  })

  it('una estadía cancelada no bloquea el inventario', async () => {
    const { error } = await insertarEstadia(PERIODO('2030-01-11', '2030-01-14'), 'cancelada')
    expect(error).toBeNull()
  })
})
