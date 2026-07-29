import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Test de integración de `cotizar_estadia`: verifica que el precio de cada noche
 * corresponde a su temporada (incluso cuando la estadía cruza de una a otra) y que
 * distingue tarifa neta (agencia) de rack (mostrador). Requiere DB local.
 *
 * Doble Standard (seed): Alta neto/rack 155/177 · Media 110/143.
 * Temporadas: Alta = 1–30 nov 2025 · Media = 1–19 dic 2025.
 */

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hayDB = Boolean(url && serviceKey && !url.includes('placeholder'))

describe.skipIf(!hayDB)('cotizar_estadia (precio por temporada)', () => {
  let db: SupabaseClient
  let tipoId: string

  beforeAll(async () => {
    db = createClient(url!, serviceKey!, { auth: { persistSession: false } })
    const { data } = await db.from('tipos_unidad').select('id').eq('codigo', 'HOST-DBL-STD').single()
    tipoId = data!.id as string
  })

  it('cobra el rack de cada noche según su temporada, cruzando Alta → Media', async () => {
    const { data, error } = await db.rpc('cotizar_estadia', {
      p_tipo_unidad_id: tipoId,
      p_check_in: '2025-11-29',
      p_check_out: '2025-12-02',
      p_tarifa_tipo: 'rack',
    })
    expect(error).toBeNull()
    const precios = (data ?? []).map((f: { precio: number | string }) => Number(f.precio))
    // 29 y 30 nov (Alta = 177) + 1 dic (Media = 143).
    expect(precios).toEqual([177, 177, 143])
  })

  it('usa la tarifa neta (agencia) cuando se pide', async () => {
    const { data } = await db.rpc('cotizar_estadia', {
      p_tipo_unidad_id: tipoId,
      p_check_in: '2025-11-10',
      p_check_out: '2025-11-12',
      p_tarifa_tipo: 'neto',
    })
    const precios = (data ?? []).map((f: { precio: number | string }) => Number(f.precio))
    expect(precios).toEqual([155, 155]) // Alta neto
  })
})
