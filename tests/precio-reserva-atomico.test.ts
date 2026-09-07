import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'

/**
 * El precio de la estadía y el total de la reserva, juntos (migración 0085).
 *
 * ── El defecto ──────────────────────────────────────────────────────────────
 *
 * Reprogramar y mudar terminaban igual: escribían el precio por noche en
 * `estadias` y el total en `reservas` con **dos `update` separados**. El propio
 * código lo admitía —«si el total no se actualiza, la reserva queda con el precio
 * de las fechas viejas», «si el precio no se recotiza, la reserva queda facturando
 * la unidad anterior»—.
 *
 * Los dos son la misma incoherencia: `reservas.total` contradiciendo al
 * `estadias.precio_noche` de su propia estadía. Y no se ve: la reserva figura
 * normal en la grilla, y se descubre al facturar, cuando ya hay un comprobante
 * emitido e inmutable.
 */

describe.skipIf(!hayDB)('precio y total, en una sola transacción', () => {
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
      .insert({ apellido: `PRECIO-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single<{ id: string }>()
    if (eH) throw new Error(`no se pudo crear el huésped: ${eH.message}`)
    huespedId = h.id
  }, 60_000)

  afterAll(async () => {
    for (const id of creadas) await db.from('reservas').delete().eq('id', id)
    await db.from('huespedes').delete().eq('id', huespedId)
  })

  /** Crea una reserva en 2034, lejos de las de cualquier otro test. */
  async function crear(dia: number, total = 200) {
    const { data, error } = await db.rpc('crear_reserva', {
      p_huesped_id: huespedId,
      p_unidad_id: unidad.id,
      p_tipo_unidad_id: unidad.tipo_unidad_id,
      p_check_in: `2034-05-${String(dia).padStart(2, '0')}`,
      p_check_out: `2034-05-${String(dia + 2).padStart(2, '0')}`,
      p_huespedes: 2,
      p_precio_noche: 100,
      p_total: total,
      p_canal: 'directo',
      p_tarifa_tipo: 'rack',
      p_estado: 'confirmada',
    })
    if (error) throw new Error(`no se pudo crear la reserva: ${error.message}`)
    const reserva = data as { id: string }
    creadas.push(reserva.id)
    return reserva.id
  }

  async function leer(reservaId: string) {
    const { data: r } = await db
      .from('reservas')
      .select('total')
      .eq('id', reservaId)
      .single<{ total: number | string }>()
    const { data: e } = await db
      .from('estadias')
      .select('precio_noche, check_in, check_out')
      .eq('reserva_id', reservaId)
      .single<{ precio_noche: number | string; check_in: string; check_out: string }>()
    return {
      total: Number(r?.total),
      precioNoche: Number(e?.precio_noche),
      checkIn: e?.check_in,
      checkOut: e?.check_out,
    }
  }

  it('mueve fechas, precio y total de una sola vez (reprogramación)', async () => {
    const id = await crear(1)

    const { data, error } = await db.rpc('aplicar_precio_reserva', {
      p_reserva_id: id,
      p_precio_noche: 130,
      p_total: 390,
      p_check_in: '2034-05-20',
      p_check_out: '2034-05-23',
    })
    expect(error, error?.message).toBeNull()
    expect((data as { ok: boolean }).ok).toBe(true)

    const estado = await leer(id)
    expect(estado.checkIn).toBe('2034-05-20')
    expect(estado.checkOut).toBe('2034-05-23')
    expect(estado.precioNoche).toBe(130)
    expect(estado.total, 'el total quedó con el precio de las fechas viejas').toBe(390)
  }, 60_000)

  it('sin fechas sólo recotiza, que es el caso de la mudanza', async () => {
    const id = await crear(6)
    const antes = await leer(id)

    const { data } = await db.rpc('aplicar_precio_reserva', {
      p_reserva_id: id,
      p_precio_noche: 150,
      p_total: 300,
    })
    expect((data as { ok: boolean }).ok).toBe(true)

    const despues = await leer(id)
    expect(despues.precioNoche).toBe(150)
    expect(despues.total).toBe(300)
    expect(despues.checkIn, 'la recotización movió las fechas').toBe(antes.checkIn)
  }, 60_000)

  it('si el período pisa otra estadía, NO cambia nada — ni el precio ni el total', async () => {
    /*
      El caso que justifica la transacción.

      Con dos `update` sueltos, el precio y el total quedaban aplicados sobre unas
      fechas que no se pudieron mover: la reserva terminaba cobrando por un
      período que no ocupa.
    */
    const ocupante = await crear(10)
    const aMover = await crear(15)
    const antes = await leer(aMover)

    const { data, error } = await db.rpc('aplicar_precio_reserva', {
      p_reserva_id: aMover,
      p_precio_noche: 999,
      p_total: 9999,
      // Se pisa con la reserva de arriba, en la misma unidad.
      p_check_in: '2034-05-10',
      p_check_out: '2034-05-12',
    })

    expect(error, error?.message).toBeNull()
    const r = data as { ok: boolean; motivo?: string }
    expect(r.ok).toBe(false)
    expect(r.motivo, 'no distinguió el choque de cupo de una falla cualquiera').toBe('ocupada')

    const despues = await leer(aMover)
    expect(despues.precioNoche, 'aplicó el precio sobre fechas que no se movieron').toBe(
      antes.precioNoche,
    )
    expect(despues.total, 'aplicó el total sobre fechas que no se movieron').toBe(antes.total)
    expect(despues.checkIn).toBe(antes.checkIn)

    // Y la reserva que ya estaba, intacta.
    expect((await leer(ocupante)).checkIn).toBe('2034-05-10')
  }, 60_000)

  it('rechaza un período al revés sin tocar nada', async () => {
    const id = await crear(25)
    const antes = await leer(id)

    const { data } = await db.rpc('aplicar_precio_reserva', {
      p_reserva_id: id,
      p_precio_noche: 500,
      p_total: 500,
      p_check_in: '2034-06-10',
      p_check_out: '2034-06-10',
    })

    expect((data as { ok: boolean; motivo?: string }).motivo).toBe('fechas')
    expect((await leer(id)).precioNoche).toBe(antes.precioNoche)
  }, 60_000)

  it('media reprogramación no significa nada: las dos fechas van juntas', async () => {
    const id = await crear(1, 200)

    const { data } = await db.rpc('aplicar_precio_reserva', {
      p_reserva_id: id,
      p_precio_noche: 100,
      p_total: 200,
      p_check_in: '2034-07-01',
    })

    expect((data as { motivo?: string }).motivo).toBe('fechas')
  }, 60_000)

  it('un importe negativo se rechaza', async () => {
    const id = await crear(1, 200)

    const { data: precio } = await db.rpc('aplicar_precio_reserva', {
      p_reserva_id: id,
      p_precio_noche: -1,
      p_total: 200,
    })
    expect((precio as { motivo?: string }).motivo).toBe('precio')

    const { data: total } = await db.rpc('aplicar_precio_reserva', {
      p_reserva_id: id,
      p_precio_noche: 100,
      p_total: -1,
    })
    expect((total as { motivo?: string }).motivo).toBe('total')
  }, 60_000)

  it('una reserva sin estadía se informa, no se rompe', async () => {
    const { data } = await db.rpc('aplicar_precio_reserva', {
      p_reserva_id: '00000000-0000-0000-0000-000000000000',
      p_precio_noche: 100,
      p_total: 200,
    })

    expect((data as { ok: boolean; motivo?: string }).ok).toBe(false)
    expect((data as { motivo?: string }).motivo).toBe('sin_estadia')
  })
})
