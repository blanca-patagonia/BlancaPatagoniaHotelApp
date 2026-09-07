import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, clienteAnonimo, hayAnon, sufijoUnico } from './db'
import {
  motivoNoAcreditar,
  saldoAcreditable,
  MENSAJES_NO_ACREDITAR,
  type MotivoNoAcreditar,
} from '@/lib/domain/facturacion'

/**
 * Notas de crédito (migración 0076).
 *
 * ── El agujero que cierran ──────────────────────────────────────────────────
 *
 * `facturas` es inmutable (0034) y hay una sola por reserva (0045), y el enum de
 * comprobantes sólo tenía A, B y C. O sea: **una factura mal emitida no tenía
 * ningún camino de corrección**. Con CAE real eso no es un inconveniente, es un
 * problema fiscal — el comprobante ya está informado a ARCA.
 */

describe('reglas de la nota de crédito', () => {
  const facturaOk = { total: 100, cae: '7'.repeat(14) }

  const caso = (over: Partial<Parameters<typeof motivoNoAcreditar>[0]> = {}) =>
    motivoNoAcreditar({
      factura: facturaOk,
      yaAcreditado: 0,
      monto: 50,
      motivo: 'error de importe',
      ...over,
    })

  it('una nota razonable se puede emitir', () => {
    expect(caso()).toBeNull()
  })

  it('sin factura no hay nada que acreditar', () => {
    expect(caso({ factura: null })).toBe('sin_factura')
  })

  it('sin CAE tampoco: el comprobante nunca llegó a ARCA', () => {
    expect(caso({ factura: { total: 100, cae: null } })).toBe('sin_cae')
  })

  it('el importe tiene que ser positivo', () => {
    expect(caso({ monto: 0 })).toBe('importe')
    expect(caso({ monto: -10 })).toBe('importe')
  })

  it('sin motivo escrito no se emite', () => {
    // Una nota de crédito sin explicación es un agujero contable que después
    // nadie puede reconstruir.
    expect(caso({ motivo: 'x' })).toBe('motivo_corto')
    expect(caso({ motivo: '   ' })).toBe('motivo_corto')
  })

  it('no se puede acreditar más de lo facturado', () => {
    expect(caso({ monto: 101 })).toBe('excede')
  })

  it('lo ya acreditado cuenta contra el tope', () => {
    // Dos notas de 60 sobre una factura de 100 devolverían IVA que nunca se cobró.
    expect(caso({ monto: 60, yaAcreditado: 60 })).toBe('excede')
    expect(caso({ monto: 40, yaAcreditado: 60 })).toBeNull()
  })

  it('el saldo acreditable nunca es negativo', () => {
    expect(saldoAcreditable(100, 30)).toBe(70)
    expect(saldoAcreditable(100, 100)).toBe(0)
    expect(saldoAcreditable(100, 150), 'un saldo negativo confundiría la pantalla').toBe(0)
  })

  it('todos los motivos tienen mensaje', () => {
    const motivos: MotivoNoAcreditar[] = [
      'sin_factura',
      'sin_cae',
      'importe',
      'excede',
      'motivo_corto',
    ]
    for (const m of motivos) {
      expect(MENSAJES_NO_ACREDITAR[m], `falta el mensaje de ${m}`).toBeTruthy()
    }
  })
})

describe.skipIf(!hayDB)('notas de crédito contra la base', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let facturaId = ''
  let reservaId = ''

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: unidad } = await db
      .from('unidades')
      .select('id, tipo_unidad_id')
      .limit(1)
      .single()
    const u = unidad as { id: string; tipo_unidad_id: string }

    const { data: h } = await db
      .from('huespedes')
      .insert({ apellido: `NC-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single()
    const huespedId = (h as { id: string }).id

    const { data: r, error } = await db.rpc('crear_reserva', {
      p_huesped_id: huespedId,
      p_unidad_id: u.id,
      p_tipo_unidad_id: u.tipo_unidad_id,
      p_check_in: '2030-07-01',
      p_check_out: '2030-07-03',
      p_huespedes: 1,
      p_precio_noche: 50,
      p_total: 100,
      p_canal: 'directo',
      p_tarifa_tipo: 'rack',
      p_estado: 'checkout',
    })
    if (error) throw new Error(`no se pudo montar la reserva: ${error.message}`)
    reservaId = (r as { id: string }).id

    const { data: f, error: eF } = await db
      .from('facturas')
      .insert({
        reserva_id: reservaId,
        numero: `NC-TEST-${sufijo}`,
        total: 100,
        tipo_comprobante: 'A',
        neto: 82.64,
        iva: 17.36,
        cae: '7'.repeat(14),
        cae_vto: '2030-12-31',
      })
      .select('id')
      .single()
    if (eF) throw new Error(`no se pudo montar la factura: ${eF.message}`)
    facturaId = (f as { id: string }).id
  }, 60_000)

  afterAll(async () => {
    await db.from('notas_credito').delete().eq('factura_id', facturaId)
    await db.from('facturas').delete().eq('id', facturaId)
    await db.from('reservas').delete().eq('id', reservaId)
    await db.from('huespedes').delete().like('apellido', `NC-${sufijo}%`)
  })

  it('la letra tiene que seguir a la factura', async () => {
    // Una nota que corrige una factura A es una NC-A. Dejarlo a criterio de quien
    // la emite es el error que después hay que corregir con otra nota.
    const { error } = await db
      .from('notas_credito')
      .insert({ factura_id: facturaId, tipo_comprobante: 'B', total: 10, motivo: 'letra mal' })

    expect(error, 'aceptó una letra distinta de la factura').not.toBeNull()
  })

  it('no se puede acreditar más de lo facturado', async () => {
    // Si se pudiera, el hotel devolvería IVA que nunca cobró.
    const { error } = await db
      .from('notas_credito')
      .insert({ factura_id: facturaId, tipo_comprobante: 'A', total: 101, motivo: 'de mas' })

    expect(error, 'aceptó acreditar más que el total de la factura').not.toBeNull()
  })

  it('el tope cuenta lo ya acreditado, no solo la nota nueva', async () => {
    const { error: e1 } = await db
      .from('notas_credito')
      .insert({ factura_id: facturaId, tipo_comprobante: 'A', total: 60, motivo: 'primera parcial' })
    expect(e1, `la primera nota válida no entró: ${e1?.message}`).toBeNull()

    // 60 + 60 = 120 sobre una factura de 100.
    const { error: e2 } = await db
      .from('notas_credito')
      .insert({ factura_id: facturaId, tipo_comprobante: 'A', total: 60, motivo: 'segunda parcial' })
    expect(e2, 'dos notas parciales superaron el total de la factura').not.toBeNull()

    // Lo que sí entra es el resto exacto.
    const { error: e3 } = await db
      .from('notas_credito')
      .insert({ factura_id: facturaId, tipo_comprobante: 'A', total: 40, motivo: 'resto exacto' })
    expect(e3, `el resto exacto tendría que entrar: ${e3?.message}`).toBeNull()
  })

  it('sin motivo no se emite', async () => {
    const { error } = await db
      .from('notas_credito')
      .insert({ factura_id: facturaId, tipo_comprobante: 'A', total: 1, motivo: 'x' })

    expect(error, 'aceptó una nota de crédito sin explicación').not.toBeNull()
  })

  it('el correlativo de notas es propio y no toca el de facturas', async () => {
    const { data: antes } = await db
      .from('puntos_venta')
      .select('ultimo_numero, ultimo_nc')
      .eq('numero', 1)
      .single()
    const a = antes as { ultimo_numero: number; ultimo_nc: number }

    const { data: nro, error } = await db.rpc('siguiente_numero_nota_credito', {
      p_punto_venta: 1,
    })
    expect(error, error?.message).toBeNull()
    expect(Number(nro)).toBe(a.ultimo_nc + 1)

    const { data: despues } = await db
      .from('puntos_venta')
      .select('ultimo_numero, ultimo_nc')
      .eq('numero', 1)
      .single()
    const d = despues as { ultimo_numero: number; ultimo_nc: number }

    // Lo importante: la numeración fiscal de facturas NO se movió.
    expect(d.ultimo_numero, 'la nota de crédito consumió un número de factura').toBe(a.ultimo_numero)
  })
})

describe.skipIf(!hayAnon)('borde público de las notas de crédito', () => {
  it('anon no las lee', async () => {
    const { data, error } = await clienteAnonimo().from('notas_credito').select('id').limit(1)
    expect(data ?? [], 'anon leyó comprobantes fiscales').toHaveLength(0)
    if (error) expect(['42501', '42P01']).toContain(error.code)
  })
})
