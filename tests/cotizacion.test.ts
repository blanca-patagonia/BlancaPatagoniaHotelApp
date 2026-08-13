import { describe, it, expect, beforeAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, hayAnon, clienteDePrueba, clienteAnonimo } from './db'

/**
 * Test de integración de `cotizar_estadia`: verifica que el precio de cada noche
 * corresponde a su temporada (incluso cuando la estadía cruza de una a otra) y que
 * distingue tarifa neta (agencia) de rack (mostrador). Requiere DB local.
 *
 * Doble Standard (seed): Alta neto/rack 155/177 · Media 110/143.
 * Temporadas: Alta = 1–30 nov 2025 · Media = 1–19 dic 2025.
 */


describe.skipIf(!hayDB)('cotizar_estadia (precio por temporada)', () => {
  let db: SupabaseClient
  let tipoId: string

  beforeAll(async () => {
    db = clienteDePrueba()
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

/**
 * El precio neto es el que el hotel negocia con las agencias: no puede salir por
 * el borde público. La aplicación siempre manda 'rack' en las rutas públicas,
 * pero eso no es una defensa —la clave publicable viaja en el bundle del
 * navegador—, así que la guarda tiene que estar en la base (migración 0030).
 *
 * Este test consulta con la clave publicable, o sea exactamente como lo haría
 * cualquiera desde internet.
 */
describe.skipIf(!hayAnon)('cotizar_estadia desde el borde público', () => {
  let db: SupabaseClient
  let publico: SupabaseClient
  let tipoId: string

  beforeAll(async () => {
    db = clienteDePrueba()
    publico = clienteAnonimo()
    const { data } = await db.from('tipos_unidad').select('id').eq('codigo', 'HOST-DBL-STD').single()
    tipoId = data!.id as string
  })

  it('devuelve rack aunque se pida neto', async () => {
    const { data, error } = await publico.rpc('cotizar_estadia', {
      p_tipo_unidad_id: tipoId,
      p_check_in: '2025-11-10',
      p_check_out: '2025-11-12',
      p_tarifa_tipo: 'neto',
    })
    expect(error).toBeNull()
    const precios = (data ?? []).map((f: { precio: number | string }) => Number(f.precio))
    // Alta: rack 177, neto 155. Pidiendo neto tiene que llegar el rack.
    expect(precios).toEqual([177, 177])
    expect(precios).not.toContain(155)
  })

  it('sigue cotizando rack con normalidad: la guarda no rompe el portal', async () => {
    const { data, error } = await publico.rpc('cotizar_estadia', {
      p_tipo_unidad_id: tipoId,
      p_check_in: '2025-11-29',
      p_check_out: '2025-12-02',
      p_tarifa_tipo: 'rack',
    })
    expect(error).toBeNull()
    const precios = (data ?? []).map((f: { precio: number | string }) => Number(f.precio))
    expect(precios).toEqual([177, 177, 143])
  })
})
