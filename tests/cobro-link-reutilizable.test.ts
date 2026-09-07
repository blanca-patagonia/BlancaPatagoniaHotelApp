import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'
import { iniciarCobro, falloElCobro } from '@/lib/payments/servicio'
import { vencimientoDelLink } from '@/lib/domain/cobro'

/**
 * Reutilización del link de pago (auditoría 2026-09, P1-5).
 *
 * ── Las dos cosas que este archivo fija ─────────────────────────────────────
 *
 * 1. **Un link se reutiliza sólo dentro del mismo medio de pago.** Sin eso, el
 *    huésped que abrió el link de Stripe y después elige «pesos con MercadoPago»
 *    recibía de vuelta el de Stripe, en dólares.
 * 2. **Pero se reutiliza.** Es la garantía original de la función: dos links vivos
 *    por la misma seña son dos cobros posibles, y devolver esa plata es un trámite
 *    manual con la pasarela. Un arreglo que rompa esto sería peor que el bug.
 */

const URLS = {
  exito: 'https://hotel.test/ok',
  error: 'https://hotel.test/error',
  pendiente: 'https://hotel.test/pendiente',
}

describe.skipIf(!hayDB)('link de pago reutilizable', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let reservaId = ''
  let huespedId = ''

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: unidad, error: eUnidad } = await db
      .from('unidades')
      .select('id, tipo_unidad_id')
      .order('nombre')
      .limit(1)
      .single<{ id: string; tipo_unidad_id: string }>()
    if (eUnidad) throw new Error(`no hay unidades: ${eUnidad.message}`)

    const { data: h, error: eH } = await db
      .from('huespedes')
      .insert({ apellido: `LINK-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single<{ id: string }>()
    if (eH) throw new Error(`no se pudo crear el huésped: ${eH.message}`)
    huespedId = h.id

    // 2032 para no chocar contra la restricción de exclusión de `estadias` con
    // ninguna otra reserva de prueba.
    const { data: r, error: eR } = await db.rpc('crear_reserva', {
      p_huesped_id: huespedId,
      p_unidad_id: unidad.id,
      p_tipo_unidad_id: unidad.tipo_unidad_id,
      p_check_in: '2032-05-10',
      p_check_out: '2032-05-12',
      p_huespedes: 1,
      p_precio_noche: 60,
      p_total: 120,
      p_canal: 'directo',
      p_tarifa_tipo: 'rack',
      p_estado: 'confirmada',
    })
    if (eR) throw new Error(`no se pudo crear la reserva: ${eR.message}`)
    reservaId = (r as { id: string }).id
  }, 60_000)

  afterAll(async () => {
    await db.from('pagos').delete().eq('reserva_id', reservaId)
    await db.from('reservas').delete().eq('id', reservaId)
    await db.from('huespedes').delete().eq('id', huespedId)
  })

  it('NO devuelve el link de otra pasarela', async () => {
    /*
      El bug, montado tal cual pasaba.

      Se deja vivo un link de MercadoPago —pendiente, con URL y sin vencer— y se
      pide un cobro por otro medio. Antes del arreglo, la consulta no filtraba por
      `medio` y devolvía ese mismo link: el huésped que eligió pesos terminaba en
      la pasarela que cobra en dólares.
    */
    const { error } = await db.from('pagos').insert({
      reserva_id: reservaId,
      medio: 'mercadopago',
      tipo: 'senia',
      monto: 120,
      moneda: 'ARS',
      monto_cobrado: 177_600,
      cotizacion: 1480,
      estado: 'pendiente',
      external_id: `bp_test_mp_${sufijo}`,
      url_pago: 'https://mercadopago.test/checkout/AJENO',
      vence_en: vencimientoDelLink(new Date()).toISOString(),
    })
    if (error) throw new Error(`no se pudo sembrar el link ajeno: ${error.message}`)

    const resultado = await iniciarCobro(db, {
      reservaId,
      tipo: 'senia',
      montoUSD: 120,
      // El simulador: es el único habilitado sin credenciales (ADR 0018).
      proveedor: 'simulado',
      descripcion: 'Seña',
      urls: URLS,
    })

    expect(falloElCobro(resultado), JSON.stringify(resultado)).toBe(false)
    if (falloElCobro(resultado)) return

    expect(
      resultado.url,
      'devolvió el link de MercadoPago para un cobro pedido por otro medio',
    ).not.toContain('AJENO')
    expect(resultado.reutilizado).toBe(false)
  })

  it('SÍ devuelve el link propio, que es para lo que existe', async () => {
    /*
      La garantía original, que el arreglo no puede romper.

      ⚠️ El simulador se elige como `simulado` y registra sus pagos como `tarjeta`
      —el enum de la base no tiene un valor «simulado»—, así que el filtro va sobre
      el nombre del proveedor y no sobre la clave de configuración. Filtrarlo mal
      no se vería como un error: se vería como un link nuevo en cada intento, o
      sea, el cobro doble que esta función evita.
    */
    const primero = await iniciarCobro(db, {
      reservaId,
      tipo: 'saldo',
      montoUSD: 120,
      proveedor: 'simulado',
      descripcion: 'Saldo',
      urls: URLS,
    })
    expect(falloElCobro(primero), JSON.stringify(primero)).toBe(false)
    if (falloElCobro(primero)) return

    const segundo = await iniciarCobro(db, {
      reservaId,
      tipo: 'saldo',
      montoUSD: 120,
      proveedor: 'simulado',
      descripcion: 'Saldo',
      urls: URLS,
    })
    expect(falloElCobro(segundo), JSON.stringify(segundo)).toBe(false)
    if (falloElCobro(segundo)) return

    expect(segundo.reutilizado, 'creó un segundo link vivo por la misma seña').toBe(true)
    expect(segundo.externalId).toBe(primero.externalId)
  })

  it('un saldo distinto NO reutiliza: el link viejo cobraría de menos', async () => {
    // Pasa cuando se cargan consumos entre un intento y el otro.
    const otro = await iniciarCobro(db, {
      reservaId,
      tipo: 'saldo',
      montoUSD: 145.2,
      proveedor: 'simulado',
      descripcion: 'Saldo con consumos',
      urls: URLS,
    })

    expect(falloElCobro(otro), JSON.stringify(otro)).toBe(false)
    if (falloElCobro(otro)) return
    expect(otro.reutilizado).toBe(false)
  })
})
