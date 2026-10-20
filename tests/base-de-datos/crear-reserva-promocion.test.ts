import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from '../apoyo/db'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'

/**
 * Promociones aplicadas al crear una reserva (auditoría QA/UX 2026-10):
 * `promociones` y el motor de precios (`lib/domain/precios.ts`) existían
 * completos y probados, pero ningún alta pasaba nunca una promoción a
 * cotizar — código muerto de punta a punta. `crearReservaEnUnidadLibre` es el
 * chokepoint compartido por el panel y el portal, así que es el lugar
 * correcto para probar esto una sola vez.
 */
describe.skipIf(!hayDB)('crearReservaEnUnidadLibre · promociones', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let huespedId = ''
  let unidad: { id: string; tipo_unidad_id: string }
  const creadasReservas: string[] = []
  const creadasPromos: string[] = []

  beforeAll(async () => {
    db = clienteDePrueba()

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
      .insert({ apellido: `PROMO-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single<{ id: string }>()
    if (eH) throw new Error(`no se pudo crear el huésped: ${eH.message}`)
    huespedId = h.id
  }, 60_000)

  afterAll(async () => {
    for (const id of creadasReservas) await db.from('reservas').delete().eq('id', id)
    for (const id of creadasPromos) await db.from('promociones').delete().eq('id', id)
    await db.from('huespedes').delete().eq('id', huespedId)
  })

  async function crearPromo(extra: Record<string, unknown>) {
    const { data, error } = await db
      .from('promociones')
      .insert({ codigo: `TEST-PROMO-${sufijo}-${creadasPromos.length}`, nombre: 'Test', ...extra })
      .select('id')
      .single<{ id: string }>()
    if (error || !data) throw new Error(`no se pudo crear la promoción de prueba: ${error?.message}`)
    creadasPromos.push(data.id)
    return data.id
  }

  it('aplica el descuento porcentual al total y lo deja guardado en la reserva', async () => {
    const promocionId = await crearPromo({ tipo: 'porcentaje', valor: 10 })

    const sinDescuento = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      unidadId: unidad.id,
      checkIn: '2026-04-10',
      checkOut: '2026-04-13',
      huespedes: 2,
      huespedId,
      canal: 'directo',
      tarifaTipo: 'rack',
      estado: 'confirmada',
    })
    expect(sinDescuento.ok, !sinDescuento.ok ? sinDescuento.error : undefined).toBe(true)
    if (!sinDescuento.ok) return
    creadasReservas.push(sinDescuento.reserva.id)

    const conDescuento = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      checkIn: '2026-04-20',
      checkOut: '2026-04-23',
      huespedes: 2,
      huespedId,
      canal: 'directo',
      tarifaTipo: 'rack',
      estado: 'confirmada',
      promocionId,
    })
    expect(conDescuento.ok, !conDescuento.ok ? conDescuento.error : undefined).toBe(true)
    if (!conDescuento.ok) return
    creadasReservas.push(conDescuento.reserva.id)

    // Mismo tipo, mismas noches (3), fechas distintas de la misma temporada:
    // el total sin descuento es la referencia para medir el 10 %.
    const { data: reservaPromo } = await db
      .from('reservas')
      .select('total, promocion_id')
      .eq('id', conDescuento.reserva.id)
      .single<{ total: number | string; promocion_id: string | null }>()
    expect(reservaPromo?.promocion_id).toBe(promocionId)
    const totalConDescuento = Number(reservaPromo?.total)
    const totalSinDescuento = Number(sinDescuento.reserva.total)
    expect(totalConDescuento).toBeLessThan(totalSinDescuento)
    // Con un 10% sobre el neto, el total con IVA baja menos de un 10% (el
    // IVA se recalcula sobre el neto descontado), pero nunca más del 10%.
    expect(totalConDescuento).toBeGreaterThan(totalSinDescuento * 0.89)
  }, 60_000)

  it('rechaza el alta si la promoción no está activa, sin crear nada', async () => {
    const promocionId = await crearPromo({ tipo: 'porcentaje', valor: 15, activo: false })

    const r = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      checkIn: '2026-04-25',
      checkOut: '2026-04-27',
      huespedes: 2,
      huespedId,
      canal: 'directo',
      tarifaTipo: 'rack',
      estado: 'confirmada',
      promocionId,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Esa promoción no está vigente. Elegí otra o sacala.')
  }, 60_000)

  it('rechaza el alta si la promoción ya venció', async () => {
    const promocionId = await crearPromo({
      tipo: 'monto',
      valor: 20,
      vigencia_desde: '2020-01-01',
      vigencia_hasta: '2020-01-31',
    })

    const r = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      checkIn: '2026-04-25',
      checkOut: '2026-04-27',
      huespedes: 2,
      huespedId,
      canal: 'directo',
      tarifaTipo: 'rack',
      estado: 'confirmada',
      promocionId,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Esa promoción no está vigente. Elegí otra o sacala.')
  }, 60_000)

  it('si no cumple sus propias condiciones (noches mínimas), cotiza sin el descuento en vez de rechazar', async () => {
    // Pide 5 noches mínimo; la estadía de prueba es de 2.
    const promocionId = await crearPromo({
      tipo: 'porcentaje',
      valor: 50,
      condiciones: { min_noches: 5 },
    })

    const sinDescuento = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      checkIn: '2026-05-15',
      checkOut: '2026-05-17',
      huespedes: 2,
      huespedId,
      canal: 'directo',
      tarifaTipo: 'rack',
      estado: 'confirmada',
    })
    expect(sinDescuento.ok, !sinDescuento.ok ? sinDescuento.error : undefined).toBe(true)
    if (!sinDescuento.ok) return
    creadasReservas.push(sinDescuento.reserva.id)

    const conPromoSinCumplir = await crearReservaEnUnidadLibre(db, {
      tipoUnidadId: unidad.tipo_unidad_id,
      checkIn: '2026-05-20',
      checkOut: '2026-05-22',
      huespedes: 2,
      huespedId,
      canal: 'directo',
      tarifaTipo: 'rack',
      estado: 'confirmada',
      promocionId,
    })
    expect(conPromoSinCumplir.ok, !conPromoSinCumplir.ok ? conPromoSinCumplir.error : undefined).toBe(true)
    if (!conPromoSinCumplir.ok) return
    creadasReservas.push(conPromoSinCumplir.reserva.id)

    const { data: fila } = await db
      .from('reservas')
      .select('total, promocion_id')
      .eq('id', conPromoSinCumplir.reserva.id)
      .single<{ total: number | string; promocion_id: string | null }>()
    // La promoción queda asociada (para que el reporte sepa que se intentó
    // usar), pero el 50% NO se aplicó: mismo total que sin ella.
    expect(fila?.promocion_id).toBe(promocionId)
    expect(Number(fila?.total)).toBe(Number(sinDescuento.reserva.total))
  }, 60_000)
})
