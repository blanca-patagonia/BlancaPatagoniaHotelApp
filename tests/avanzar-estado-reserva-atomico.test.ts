import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'

/**
 * El camino de estados de una reserva, en una sola transacción (migración 0109,
 * issue #85).
 *
 * ── El defecto ──────────────────────────────────────────────────────────────
 *
 * `saldarSiCorresponde` recorría el camino entre el estado actual y el que
 * corresponde según lo cobrado (p. ej. `pendiente → confirmada → pagada`) con
 * un `update` POR PASO. Si el primero entraba y el segundo fallaba, la reserva
 * quedaba en el estado intermedio **para siempre**: ya estaba cobrada del
 * todo, pero el sistema seguía mostrándola como si sólo tuviera la seña, y
 * nada volvía a intentarlo salvo que llegara otro pago.
 */

describe.skipIf(!hayDB)('avanzar_estado_reserva · el camino entero o ninguno', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let huespedId = ''
  let unidad: { id: string; tipo_unidad_id: string }
  const creadas: string[] = []

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: u, error: eU } = await db
      .from('unidades')
      .select('id, tipo_unidad_id')
      .order('nombre')
      .limit(1)
      .single<{ id: string; tipo_unidad_id: string }>()
    if (eU) throw new Error(`no hay unidades: ${eU.message}`)
    unidad = u

    const { data: h, error: eH } = await db
      .from('huespedes')
      .insert({ apellido: `CAMINO-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single<{ id: string }>()
    if (eH) throw new Error(`no se pudo crear el huésped: ${eH.message}`)
    huespedId = h.id
  }, 60_000)

  afterAll(async () => {
    for (const id of creadas) await db.from('reservas').delete().eq('id', id)
    await db.from('huespedes').delete().eq('id', huespedId)
  })

  // Reparto de fechas de agosto de 2034, todas en la misma unidad, sin pisarse.
  async function crear(dia: number) {
    const { data, error } = await db.rpc('crear_reserva', {
      p_huesped_id: huespedId,
      p_unidad_id: unidad.id,
      p_tipo_unidad_id: unidad.tipo_unidad_id,
      p_check_in: `2034-08-${String(dia).padStart(2, '0')}`,
      p_check_out: `2034-08-${String(dia + 2).padStart(2, '0')}`,
      p_huespedes: 2,
      p_precio_noche: 100,
      p_total: 200,
      p_canal: 'web',
      p_tarifa_tipo: 'rack',
      p_estado: 'pendiente',
    })
    if (error) throw new Error(`no se pudo crear la reserva: ${error.message}`)
    const reserva = data as { id: string }
    creadas.push(reserva.id)
    return reserva.id
  }

  async function leerEstado(reservaId: string) {
    const { data } = await db
      .from('reservas')
      .select('estado')
      .eq('id', reservaId)
      .single<{ estado: string }>()
    return data?.estado
  }

  it('aplica un camino de dos pasos de una sola vez', async () => {
    const id = await crear(1)

    const { data, error } = await db.rpc('avanzar_estado_reserva', {
      p_reserva_id: id,
      p_desde: 'pendiente',
      p_camino: ['confirmada', 'pagada'],
    })
    expect(error, error?.message).toBeNull()
    expect((data as { ok: boolean; estado: string }).ok).toBe(true)
    expect((data as { estado: string }).estado).toBe('pagada')
    expect(await leerEstado(id)).toBe('pagada')
  }, 60_000)

  it(
    'si un paso del medio es inválido, NO queda ningún paso aplicado — ' +
      'ni siquiera el primero, que por sí solo era válido',
    async () => {
      /*
        El caso que justifica la transacción: antes, el `update` a `confirmada`
        era un viaje aparte y ya habría entrado cuando el siguiente paso
        fallara. Acá los dos van en la misma llamada, así que el casteo
        inválido del segundo tiene que deshacer también el primero.
      */
      const id = await crear(4)

      const { error } = await db.rpc('avanzar_estado_reserva', {
        p_reserva_id: id,
        p_desde: 'pendiente',
        p_camino: ['confirmada', 'no_es_un_estado'],
      })
      expect(error, 'un paso inválido tiene que fallar, no aplicarse a medias').not.toBeNull()

      expect(
        await leerEstado(id),
        'el paso válido (confirmada) quedó aplicado aunque el siguiente rompiera todo',
      ).toBe('pendiente')
    },
    60_000,
  )

  it('si el punto de partida ya cambió, no toca nada y lo informa', async () => {
    /*
      Simula la carrera entre el mostrador y el webhook para el mismo pago: la
      reserva ya está en `confirmada` cuando esta llamada todavía cree que
      sigue en `pendiente`.
    */
    const id = await crear(8)
    const { error: ePrevio } = await db.rpc('avanzar_estado_reserva', {
      p_reserva_id: id,
      p_desde: 'pendiente',
      p_camino: ['confirmada'],
    })
    expect(ePrevio).toBeNull()

    const { data, error } = await db.rpc('avanzar_estado_reserva', {
      p_reserva_id: id,
      p_desde: 'pendiente', // desactualizado: ya está en confirmada
      p_camino: ['confirmada', 'pagada'],
    })
    expect(error, error?.message).toBeNull()
    const r = data as { ok: boolean; motivo?: string; actual?: string }
    expect(r.ok).toBe(false)
    expect(r.motivo).toBe('estado_cambio')
    expect(r.actual).toBe('confirmada')
    expect(await leerEstado(id)).toBe('confirmada')
  }, 60_000)

  it('un camino vacío no rompe nada y se informa', async () => {
    const { data } = await db.rpc('avanzar_estado_reserva', {
      p_reserva_id: '00000000-0000-0000-0000-000000000000',
      p_desde: 'pendiente',
      p_camino: [],
    })
    expect((data as { ok: boolean; motivo?: string }).motivo).toBe('camino_vacio')
  })

  it('una reserva que no existe se informa, no se rompe', async () => {
    const { data } = await db.rpc('avanzar_estado_reserva', {
      p_reserva_id: '00000000-0000-0000-0000-000000000000',
      p_desde: 'pendiente',
      p_camino: ['confirmada'],
    })
    expect((data as { ok: boolean; motivo?: string }).motivo).toBe('sin_reserva')
  })
})
