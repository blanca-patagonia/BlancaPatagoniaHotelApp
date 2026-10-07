import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'

/**
 * El choque de cupo contra `crearReservaEnUnidadLibre` (Fase 2.4 del pulido
 * integral): el camino que comparten el alta del panel Y el checkout del
 * portal público.
 *
 * ── Lo que faltaba ───────────────────────────────────────────────────────
 *
 * El rechazo por solapamiento (23P01, restricción de exclusión del ADR 0002)
 * ya tenía test para la mudanza (`tests/acciones/mudanza.test.ts`, "RECHAZA
 * mudar a una unidad ocupada") y para la recotización
 * (`tests/precio-reserva-atomico.test.ts`). Lo que NO tenía test era el
 * camino más transitado de todos —el alta misma—, que es el único de los
 * tres que corre con el huésped esperando en vivo (en el panel Y en el
 * portal): si ahí el error se escapara sin capturar, lo que llegaría no
 * sería "la unidad ya no está disponible" sino una excepción cruda camino a
 * un 500.
 */
describe.skipIf(!hayDB)('crearReservaEnUnidadLibre · el choque de cupo no es un 500', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let huespedId = ''
  let unidad: { id: string; tipo_unidad_id: string }
  const creadas: string[] = []

  beforeAll(async () => {
    db = clienteDePrueba()

    /*
      Mismo motivo que en `tests/acciones/reservas.test.ts` ("Los tests
      eligen un tipo con tarifa, no uno cualquiera", PR #51): desde la
      migración 0106 hay tipos de unidad reales sin tarifa cargada a
      propósito (Upsala, Moreno), así que "la primera unidad libre" puede
      no poder cotizarse. Se pregunta primero qué tipo SÍ tiene tarifa.
    */
    const { data: tarifa, error: eTarifa } = await db
      .from('tarifas')
      .select('tipo_unidad_id')
      .eq('vigente', true)
      .limit(1)
      .single<{ tipo_unidad_id: string }>()
    if (eTarifa || !tarifa) throw new Error(`no hay tarifa vigente: revisá el seed (${eTarifa?.message})`)

    const { data: u, error: eU } = await db
      .from('unidades')
      .select('id, tipo_unidad_id')
      .eq('tipo_unidad_id', tarifa.tipo_unidad_id)
      .order('nombre')
      .limit(1)
      .single<{ id: string; tipo_unidad_id: string }>()
    if (eU || !u) throw new Error(`no hay unidades del tipo con tarifa: ${eU?.message}`)
    unidad = u

    const { data: h, error: eH } = await db
      .from('huespedes')
      .insert({ apellido: `CHOQUE-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single<{ id: string }>()
    if (eH) throw new Error(`no se pudo crear el huésped: ${eH.message}`)
    huespedId = h.id
  }, 60_000)

  afterAll(async () => {
    for (const id of creadas) await db.from('reservas').delete().eq('id', id)
    await db.from('huespedes').delete().eq('id', huespedId)
  })

  it('la primera entra, la segunda para las MISMAS fechas y unidad se rechaza legible', async () => {
    // Dentro de un rango de temporada real cargado (2026-04-05 a 2026-06-01):
    // crearReservaEnUnidadLibre cotiza de verdad, a diferencia de crear_reserva
    // a secas, que recibe el precio ya calculado y no necesita tarifa vigente.
    const checkIn = '2026-04-10'
    const checkOut = '2026-04-13'

    const primera = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      unidadId: unidad.id, // puntual: sin esto, "la primera libre del tipo" podría elegir otra unidad
      checkIn,
      checkOut,
      huespedes: 2,
      huespedId,
      canal: 'directo',
      tarifaTipo: 'rack',
      estado: 'confirmada',
    })
    expect(primera.ok, !primera.ok ? primera.error : undefined).toBe(true)
    if (primera.ok) creadas.push(primera.reserva.id)

    // La segunda, mismas fechas, misma unidad puntual: tiene que chocar.
    const segunda = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      unidadId: unidad.id,
      checkIn,
      checkOut,
      huespedes: 2,
      huespedId,
      canal: 'directo',
      tarifaTipo: 'rack',
      estado: 'confirmada',
    })

    expect(segunda.ok).toBe(false)
    if (!segunda.ok) {
      expect(segunda.error).toBe('Esa unidad ya no está disponible para esas fechas. Elegí otra.')
    }
  }, 60_000)

  it('sin indicar una unidad puntual, si no queda ninguna libre del tipo también es legible', async () => {
    /*
      Mismo choque, pero por el camino que usa el portal público (nunca
      manda `unidadId`: "la primera libre del tipo"). Se ocupan TODAS las
      unidades del tipo en un rango nuevo y se confirma que la próxima
      también se rechaza con un mensaje, no con una excepción.
    */
    const checkIn = '2026-05-10'
    const checkOut = '2026-05-12'

    const { data: todasDelTipo } = await db
      .from('unidades')
      .select('id')
      .eq('tipo_unidad_id', unidad.tipo_unidad_id)
    const unidades = (todasDelTipo ?? []) as { id: string }[]
    expect(unidades.length, 'no hay unidades de este tipo para agotar').toBeGreaterThan(0)

    for (const u of unidades) {
      const r = await crearReservaEnUnidadLibre(db, {
        tipoUnidadId: unidad.tipo_unidad_id,
        unidadId: u.id,
        checkIn,
        checkOut,
        huespedes: 2,
        huespedId,
        canal: 'web',
        tarifaTipo: 'rack',
        estado: 'confirmada',
      })
      expect(r.ok, !r.ok ? r.error : undefined).toBe(true)
      if (r.ok) creadas.push(r.reserva.id)
    }

    // Agotado el tipo entero, la próxima (sin unidad puntual, como el portal) no revienta.
    const sinCupo = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      checkIn,
      checkOut,
      huespedes: 2,
      huespedId,
      canal: 'web',
      tarifaTipo: 'rack',
      estado: 'pendiente',
    })
    expect(sinCupo.ok).toBe(false)
    if (!sinCupo.ok) {
      expect(sinCupo.error).toBe('No hay unidades disponibles de ese tipo para esas fechas.')
    }
  }, 60_000)
})
