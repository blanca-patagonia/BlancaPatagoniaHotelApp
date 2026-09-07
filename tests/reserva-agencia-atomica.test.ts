import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'

/**
 * La reserva de agencia nace con su agencia (migración 0084, hallazgo P1-7).
 *
 * ── El defecto ──────────────────────────────────────────────────────────────
 *
 * `crearReserva` daba de alta la reserva con `crear_reserva` —que es atómica— y
 * **después**, en un `update` aparte, le ponía `agencia_id`. Si ese segundo paso
 * fallaba, la reserva **existía y no estaba vinculada a nadie**.
 *
 * Ese vínculo no es decorativo: decide a quién se le factura, qué tarifa
 * corresponde (neto de agencia contra rack de mostrador, ADR 0004) y qué cuenta
 * corriente se debita. Una reserva de agencia sin `agencia_id` es una estadía que
 * el hotel presta y no le cobra a nadie.
 */

describe.skipIf(!hayDB)('reserva de agencia, en una sola transacción', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let agenciaId = ''
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

    const { data: a, error: eA } = await db
      .from('agencias')
      .insert({ nombre: `Agencia atómica ${sufijo}` })
      .select('id')
      .single<{ id: string }>()
    if (eA) throw new Error(`no se pudo crear la agencia: ${eA.message}`)
    agenciaId = a.id

    const { data: h, error: eH } = await db
      .from('huespedes')
      .insert({ apellido: `ATOM-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single<{ id: string }>()
    if (eH) throw new Error(`no se pudo crear el huésped: ${eH.message}`)
    huespedId = h.id
  }, 60_000)

  afterAll(async () => {
    for (const id of creadas) await db.from('reservas').delete().eq('id', id)
    await db.from('huespedes').delete().eq('id', huespedId)
    await db.from('agencias').delete().eq('id', agenciaId)
  })

  /** Crea una reserva en 2033, lejos de las de cualquier otro test. */
  async function crear(agencia: string | null, dia: number) {
    const { data, error } = await db.rpc('crear_reserva', {
      p_huesped_id: huespedId,
      p_unidad_id: unidad.id,
      p_tipo_unidad_id: unidad.tipo_unidad_id,
      p_check_in: `2033-03-${String(dia).padStart(2, '0')}`,
      p_check_out: `2033-03-${String(dia + 1).padStart(2, '0')}`,
      p_huespedes: 2,
      p_precio_noche: 100,
      p_total: 100,
      p_canal: 'directo',
      p_tarifa_tipo: agencia ? 'neto' : 'rack',
      p_estado: 'confirmada',
      p_agencia_id: agencia,
    })
    if (error) throw new Error(`no se pudo crear la reserva: ${error.message}`)
    const reserva = data as { id: string; agencia_id: string | null }
    creadas.push(reserva.id)
    return reserva
  }

  it('la reserva vuelve YA vinculada a la agencia', async () => {
    // Antes hacían falta dos llamadas y la segunda podía fallar.
    const reserva = await crear(agenciaId, 1)

    expect(reserva.agencia_id, 'la reserva nació sin agencia').toBe(agenciaId)
  }, 60_000)

  it('y la estadía existe: las dos cosas, o ninguna', async () => {
    const reserva = await crear(agenciaId, 5)

    const { data } = await db
      .from('estadias')
      .select('id')
      .eq('reserva_id', reserva.id)
      .maybeSingle()

    expect(data, 'quedó una reserva de agencia sin estadía').not.toBeNull()
  }, 60_000)

  it('sin agencia sigue funcionando igual: el parámetro es opcional', async () => {
    /*
      El portal público y el mostrador sin convenio no mandan agencia. Ese fue el
      argumento con el que el vínculo había quedado fuera de la función atómica
      —«el helper es compartido con el portal público»— y la conclusión estaba
      mal: el parámetro puede ser opcional.
    */
    const reserva = await crear(null, 10)

    expect(reserva.agencia_id).toBeNull()
  }, 60_000)

  it('no quedó una sobrecarga: la llamada por nombre resuelve sin ambigüedad', async () => {
    /*
      La trampa que la propia migración advierte: cambiar la lista de argumentos
      con `create or replace` crea una **sobrecarga** en vez de reemplazar. Con
      dos versiones conviviendo, PostgREST responde `PGRST203` —«could not choose
      the best candidate function»— o, peor, resuelve a la vieja, que ignora la
      agencia.

      ⚠️ Esto NO se comprueba con una consulta aparte: se comprueba porque los
      tres casos de arriba **llamaron a la función por nombre y funcionaron**. Un
      test que contara filas de un catálogo diría menos que eso.

      Lo que se agrega acá es la evidencia negativa: una llamada con un argumento
      que sólo existe en la firma nueva tiene que resolver a la nueva, y el error
      de ambigüedad tiene código propio.
    */
    const { error } = await db.rpc('crear_reserva', {
      p_huesped_id: huespedId,
      p_unidad_id: unidad.id,
      p_tipo_unidad_id: unidad.tipo_unidad_id,
      // Rango inválido a propósito: interesa CÓMO falla, no que entre otra fila.
      p_check_in: '2033-04-10',
      p_check_out: '2033-04-10',
      p_huespedes: 1,
      p_precio_noche: 100,
      p_total: 100,
      p_agencia_id: agenciaId,
    })

    expect(error, 'un check-out igual al check-in tendría que fallar').not.toBeNull()
    expect(
      error?.code,
      `resolvió mal la función: ${error?.code} ${error?.message}`,
    ).not.toBe('PGRST203')
    // 22007 es el que levanta la propia función: llegó adentro, o sea que la
    // resolución fue correcta.
    expect(error?.code).toBe('22007')
  })
})
