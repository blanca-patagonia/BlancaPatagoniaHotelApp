import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'

/**
 * Test de integración de la ficha de reserva completa (paso 6).
 *
 * ── Qué se verifica y por qué sólo se puede acá ──────────────────────────────
 *
 * La migración 0039 tomó una decisión que hay que fijar con un test: **el pax de
 * la estadía se DERIVA del desglose** dentro de `crear_reserva`, en lugar de
 * garantizarse con un `check` en la tabla.
 *
 * La razón de no poner el check está en la migración: habría hecho fallar los
 * `update` de mudanza (0028) y reprogramación, que tocan la unidad y el período
 * sin mirar el pax, y cualquier `insert` directo futuro con sólo `huespedes`. La
 * contracara es que la coherencia depende de esta función, así que si alguien la
 * modifica sin cuidado nada más lo detecta. Estos tests son ese detector.
 *
 * El caso que más importa: **los bebés no suman al pax**. Si sumaran, una cabaña
 * para 4 con dos adultos, un menor y un bebé daría «completo» y el sistema
 * rechazaría una reserva perfectamente válida.
 */

const sufijo = sufijoUnico()

describe.skipIf(!hayDB)('crear_reserva con desglose de ocupantes', () => {
  let db: SupabaseClient
  const ids: Record<string, string> = {}
  const reservas: string[] = []

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: tipo } = await db
      .from('tipos_unidad')
      .insert({
        codigo: `TEST-FICHA-${sufijo}`,
        nombre: 'Test ficha',
        categoria: 'cabana',
        capacidad_max: 4,
      })
      .select('id')
      .single()
    ids.tipo = tipo!.id

    // Varias unidades: cada caso ocupa una y no queremos chocar con la exclusión.
    for (let i = 1; i <= 4; i++) {
      const { data: u } = await db
        .from('unidades')
        .insert({ tipo_unidad_id: ids.tipo, nombre: `Test ficha ${i} ${sufijo}` })
        .select('id')
        .single()
      ids[`u${i}`] = u!.id
    }

    const { data: h } = await db
      .from('huespedes')
      .insert({ nombre: 'Test', apellido: `Ficha${sufijo}` })
      .select('id')
      .single()
    ids.huesped = h!.id
  })

  afterAll(async () => {
    for (const id of reservas) await db.from('reservas').delete().eq('id', id)
    for (let i = 1; i <= 4; i++) {
      if (ids[`u${i}`]) await db.from('unidades').delete().eq('id', ids[`u${i}`])
    }
    if (ids.tipo) await db.from('tipos_unidad').delete().eq('id', ids.tipo)
    if (ids.huesped) await db.from('huespedes').delete().eq('id', ids.huesped)
  })

  /** Llama a la RPC y devuelve la reserva + su estadía. */
  async function crear(unidad: string, desde: string, hasta: string, extra: Record<string, unknown> = {}) {
    const { data: reserva, error } = await db.rpc('crear_reserva', {
      p_huesped_id: ids.huesped,
      p_unidad_id: unidad,
      p_tipo_unidad_id: ids.tipo,
      p_check_in: desde,
      p_check_out: hasta,
      p_huespedes: 2,
      p_precio_noche: 100,
      p_total: 242,
      ...extra,
    })
    if (error) throw new Error(`crear_reserva falló: ${error.message}`)

    const r = reserva as { id: string }
    reservas.push(r.id)

    const { data: estadia } = await db
      .from('estadias')
      .select('huespedes, adultos, menores, bebes, camas_extra, cunas, no_mover')
      .eq('reserva_id', r.id)
      .single()

    const { data: fila } = await db
      .from('reservas')
      .select('plan, garantia, segmento, voucher, descuento_pct, subtotal, total_neto, iva, total')
      .eq('id', r.id)
      .single()

    return { reserva: fila!, estadia: estadia! }
  }

  it('sin desglose se comporta como antes: todos adultos', async () => {
    // Retrocompatibilidad: las llamadas viejas siguen funcionando sin cambios.
    const { estadia } = await crear(ids.u1, '2028-02-01', '2028-02-03')

    expect(estadia.huespedes).toBe(2)
    expect(estadia.adultos).toBe(2)
    expect(estadia.menores).toBe(0)
  })

  it('con desglose, el pax se DERIVA de adultos + menores', async () => {
    // `p_huespedes` dice 2, pero el desglose dice 2 adultos + 1 menor: gana el
    // desglose. Así las dos columnas no pueden nacer contradiciéndose.
    const { estadia } = await crear(ids.u2, '2028-02-01', '2028-02-03', {
      p_adultos: 2,
      p_menores: 1,
    })

    expect(estadia.adultos).toBe(2)
    expect(estadia.menores).toBe(1)
    expect(estadia.huespedes).toBe(3)
  })

  it('LOS BEBÉS NO SUMAN AL PAX', async () => {
    // Es la regla central. Una cabaña para 4 con 2 adultos + 1 menor + 2 bebés
    // ocupa 3 plazas, no 5. Si sumaran, esta reserva válida sería rechazada.
    const { estadia } = await crear(ids.u3, '2028-02-01', '2028-02-03', {
      p_adultos: 2,
      p_menores: 1,
      p_bebes: 2,
      p_cunas: 2,
    })

    expect(estadia.bebes).toBe(2)
    expect(estadia.cunas).toBe(2)
    expect(estadia.huespedes).toBe(3)
  })

  it('guarda camas extra y «no mover»', async () => {
    const { estadia } = await crear(ids.u4, '2028-02-01', '2028-02-03', {
      p_adultos: 3,
      p_camas_extra: 1,
      p_no_mover: true,
    })

    expect(estadia.camas_extra).toBe(1)
    expect(estadia.no_mover).toBe(true)
  })

  it('el pax nunca queda en cero: la columna tiene un check > 0', async () => {
    const { estadia } = await crear(ids.u1, '2028-03-01', '2028-03-03', {
      p_adultos: 0,
      p_menores: 0,
      p_bebes: 1,
    })

    expect(estadia.huespedes).toBe(1)
  })

  it('guarda los datos comerciales en la misma transacción', async () => {
    // Van en la MISMA llamada y no en un `update` posterior: si fueran dos pasos,
    // un fallo en el segundo dejaría la reserva creada con la ficha a medias.
    const { reserva } = await crear(ids.u2, '2028-03-01', '2028-03-03', {
      p_plan: 'media_pension',
      p_garantia: 'tarjeta',
      p_segmento: 'corporativo',
      p_voucher: 'VCH-9988',
      p_descuento_pct: 10,
    })

    expect(reserva.plan).toBe('media_pension')
    expect(reserva.garantia).toBe('tarjeta')
    expect(reserva.segmento).toBe('corporativo')
    expect(reserva.voucher).toBe('VCH-9988')
    expect(Number(reserva.descuento_pct)).toBe(10)
  })

  it('guarda el desglose fiscal, que antes no se podía recuperar del total', async () => {
    // `tarifas.iva_pct` puede variar por tarifa, así que dividir el total por 1,21
    // daba un neto aproximado y silenciosamente equivocado.
    const { reserva } = await crear(ids.u3, '2028-03-01', '2028-03-03', {
      p_subtotal: 200,
      p_total_neto: 200,
      p_iva: 42,
      p_total: 242,
    })

    expect(Number(reserva.subtotal)).toBe(200)
    expect(Number(reserva.total_neto)).toBe(200)
    expect(Number(reserva.iva)).toBe(42)
    // El total con IVA cierra con el desglose.
    expect(Number(reserva.total_neto) + Number(reserva.iva)).toBe(Number(reserva.total))
  })

  it('los valores por omisión son los del hotel', async () => {
    const { reserva } = await crear(ids.u4, '2028-03-01', '2028-03-03')

    // El Tarifario incluye desayuno: poner «solo alojamiento» por defecto haría
    // que toda reserva nueva prometiera menos de lo que el hotel da.
    expect(reserva.plan).toBe('desayuno')
    expect(reserva.garantia).toBe('sin_garantia')
    expect(reserva.segmento).toBe('particular')
  })

  it('el anti-overbooking sigue abortando toda la operación', async () => {
    // La garantía central del sistema (ADR 0002) no se tocó, pero la migración
    // reemplazó la función que la contiene: hay que verificar que el `exception`
    // handler siga en su lugar.
    const { error } = await db.rpc('crear_reserva', {
      p_huesped_id: ids.huesped,
      p_unidad_id: ids.u1,
      p_check_in: '2028-02-01',
      p_check_out: '2028-02-03',
      p_tipo_unidad_id: ids.tipo,
      p_huespedes: 2,
      p_precio_noche: 100,
      p_total: 242,
      p_adultos: 2,
    })

    expect(error).not.toBeNull()
    expect(error!.code).toBe('23P01')

    // Y no quedó una reserva huérfana.
    const { count } = await db
      .from('reservas')
      .select('id', { count: 'exact', head: true })
      .eq('huesped_id', ids.huesped)

    expect(count).toBe(reservas.length)
  })

  it('sigue rechazando un check-out anterior al check-in', async () => {
    const { error } = await db.rpc('crear_reserva', {
      p_huesped_id: ids.huesped,
      p_unidad_id: ids.u1,
      p_tipo_unidad_id: ids.tipo,
      p_check_in: '2028-05-10',
      p_check_out: '2028-05-08',
      p_huespedes: 2,
      p_precio_noche: 100,
      p_total: 242,
    })

    expect(error).not.toBeNull()
    expect(error!.code).toBe('22007')
  })
})

describe.skipIf(!hayDB)('VIP en la ficha del huésped', () => {
  let db: SupabaseClient
  let huespedId = ''

  beforeAll(async () => {
    db = clienteDePrueba()
    const { data } = await db
      .from('huespedes')
      .insert({ nombre: 'Vip', apellido: `Test${sufijo}`, vip: true })
      .select('id')
      .single()
    huespedId = data!.id
  })

  afterAll(async () => {
    if (huespedId) await db.from('huespedes').delete().eq('id', huespedId)
  })

  it('el VIP vive en el huésped, no en la reserva', async () => {
    // Quien es VIP lo es siempre: ponerlo por reserva obligaría a marcarlo de
    // nuevo cada vez que vuelve, y tarde o temprano alguien se olvidaría.
    const { data } = await db.from('huespedes').select('vip').eq('id', huespedId).single()
    expect(data!.vip).toBe(true)
  })

  it('por omisión nadie es VIP', async () => {
    const { data } = await db
      .from('huespedes')
      .insert({ nombre: 'Normal', apellido: `Test${sufijo}` })
      .select('id, vip')
      .single()

    expect(data!.vip).toBe(false)
    await db.from('huespedes').delete().eq('id', data!.id)
  })
})
