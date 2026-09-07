import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, hayAnon, clienteDePrueba, clienteAnonimo, sufijoUnico } from './db'

/**
 * Las garantías que impone la BASE en la conciliación (migraciones 0077 y 0078).
 *
 * Lo que se prueba acá no se puede probar en el dominio: son restricciones de
 * Postgres, y son las que siguen valiendo el día que alguien escriba desde otro
 * lado —un script, el dashboard de Supabase, una acción nueva que se olvide de un
 * campo—.
 */

describe.skipIf(!hayDB)('movimientos externos · lo que garantiza la base', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  const prefijo = `test-conc-${sufijo}`

  beforeAll(() => {
    db = clienteDePrueba()
  })

  afterAll(async () => {
    await db.from('movimientos_externos').delete().like('external_id', `${prefijo}%`)
  })

  const movimiento = (over: Record<string, unknown> = {}) => ({
    origen: 'banco',
    external_id: `${prefijo}-1`,
    fecha: '2026-09-05',
    descripcion: 'TRANSFERENCIA DE PRUEBA',
    monto: -1000,
    moneda: 'ARS',
    ...over,
  })

  it('reimportar el mismo movimiento no lo duplica', async () => {
    /*
      La garantía central de la 0077.

      Nadie se acuerda de si ya subió el extracto del mes. Sin esta restricción,
      subirlo dos veces duplicaría todos los movimientos y el mes cerraría al doble
      **sin ningún error**.
    */
    const { error: e1 } = await db.from('movimientos_externos').insert(movimiento())
    expect(e1, `el primero tendría que entrar: ${e1?.message}`).toBeNull()

    const { error: e2 } = await db.from('movimientos_externos').insert(movimiento())
    expect(e2?.code, 'aceptó el mismo movimiento dos veces').toBe('23505')
  })

  it('el mismo id en otro origen SÍ entra', async () => {
    // La clave es `(origen, external_id)`: el banco y MercadoPago numeran cada uno
    // por su cuenta y pueden coincidir sin que sean el mismo movimiento.
    const { error } = await db
      .from('movimientos_externos')
      .insert(movimiento({ origen: 'mercadopago' }))

    expect(error, error?.message).toBeNull()
  })

  it('un pago no se puede conciliar contra dos movimientos', async () => {
    /*
      Sería contar el mismo cobro dos veces en el arqueo.

      Lo impide un índice único parcial —parcial porque `pago_id` es nulo mientras
      el movimiento no se concilió, y ahí no hay nada que unificar—.
    */
    const { data: pago } = await db
      .from('pagos')
      .select('id')
      .limit(1)
      .maybeSingle<{ id: string }>()

    if (!pago) {
      // Sin pagos en la base no hay nada que probar, pero no se puede pasar en
      // silencio: sería un caso que dice verificar algo y no lo verifica.
      throw new Error('No hay ningún pago en la base para probar la conciliación doble.')
    }

    const a = `${prefijo}-doble-a`
    const b = `${prefijo}-doble-b`
    await db
      .from('movimientos_externos')
      .insert([
        movimiento({ external_id: a, monto: 100 }),
        movimiento({ external_id: b, monto: 100 }),
      ])

    const { error: e1 } = await db
      .from('movimientos_externos')
      .update({ estado: 'conciliado', pago_id: pago.id })
      .eq('external_id', a)
    expect(e1, `la primera conciliación tendría que entrar: ${e1?.message}`).toBeNull()

    const { error: e2 } = await db
      .from('movimientos_externos')
      .update({ estado: 'conciliado', pago_id: pago.id })
      .eq('external_id', b)
    expect(e2?.code, 'el mismo pago se concilió contra dos movimientos').toBe('23505')
  })

  it('un origen que no existe se rechaza', async () => {
    const { error } = await db
      .from('movimientos_externos')
      .insert(movimiento({ external_id: `${prefijo}-origen`, origen: 'binance' }))

    expect(error, 'aceptó un origen desconocido').not.toBeNull()
  })

  it('un estado que no existe se rechaza', async () => {
    const { error } = await db
      .from('movimientos_externos')
      .insert(movimiento({ external_id: `${prefijo}-estado`, estado: 'revisado' }))

    expect(error, 'aceptó un estado desconocido').not.toBeNull()
  })
})

describe.skipIf(!hayDB)('moneda en las cuentas corrientes (migración 0078)', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let proveedorId = ''
  let agenciaId = ''

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: p, error: eP } = await db
      .from('proveedores')
      .insert({ nombre: `Proveedor moneda ${sufijo}` })
      .select('id')
      .single<{ id: string }>()
    if (eP) throw new Error(`no se pudo montar el proveedor: ${eP.message}`)
    proveedorId = p.id

    const { data: a, error: eA } = await db
      .from('agencias')
      .insert({ nombre: `Agencia moneda ${sufijo}` })
      .select('id')
      .single<{ id: string }>()
    if (eA) throw new Error(`no se pudo montar la agencia: ${eA.message}`)
    agenciaId = a.id
  })

  afterAll(async () => {
    await db.from('movimientos_proveedor').delete().eq('proveedor_id', proveedorId)
    await db.from('movimientos_cuenta').delete().eq('agencia_id', agenciaId)
    await db.from('proveedores').delete().eq('id', proveedorId)
    await db.from('agencias').delete().eq('id', agenciaId)
  })

  it('un cargo en pesos SIN cotización no entra', async () => {
    /*
      El hallazgo P1-3, cerrado en la base.

      `monto` está siempre en USD y es lo único que suma `saldoCuenta`. Un
      movimiento en pesos sin cotización deja el importe en dólares sin ninguna
      explicación: no hay forma de reconstruir de dónde salió.
    */
    const { error } = await db
      .from('movimientos_proveedor')
      .insert({ proveedor_id: proveedorId, tipo: 'cargo', monto: 125, moneda: 'ARS' })

    expect(error, 'aceptó un cargo en pesos sin cotización').not.toBeNull()
  })

  it('con el detalle completo, sí', async () => {
    const { error } = await db.from('movimientos_proveedor').insert({
      proveedor_id: proveedorId,
      tipo: 'cargo',
      monto: 125,
      moneda: 'ARS',
      monto_origen: 185_000,
      cotizacion: 1480,
    })

    expect(error, error?.message).toBeNull()
  })

  it('en dólares, el detalle no puede contradecir al monto', async () => {
    // Un `monto_origen` distinto del `monto` en USD significaría que se cargó de
    // más o de menos sin que nadie lo note.
    const { error } = await db.from('movimientos_proveedor').insert({
      proveedor_id: proveedorId,
      tipo: 'cargo',
      monto: 100,
      moneda: 'USD',
      monto_origen: 250,
      cotizacion: 1,
    })

    expect(error, 'aceptó un detalle que contradice al importe en dólares').not.toBeNull()
  })

  it('una moneda que el sistema no sabe cotizar se rechaza', async () => {
    // Sin cotización posible, el saldo en dólares sería inventado.
    const { error } = await db.from('movimientos_cuenta').insert({
      agencia_id: agenciaId,
      tipo: 'cargo',
      monto: 100,
      moneda: 'CLP',
      monto_origen: 95_000,
      cotizacion: 950,
    })

    expect(error, 'aceptó una moneda desconocida').not.toBeNull()
  })

  it('la misma regla vale en la cuenta de la agencia', async () => {
    const { error: sinCotizacion } = await db
      .from('movimientos_cuenta')
      .insert({ agencia_id: agenciaId, tipo: 'cargo', monto: 125, moneda: 'ARS' })
    expect(sinCotizacion, 'aceptó un cargo en pesos sin cotización').not.toBeNull()

    const { error: completo } = await db.from('movimientos_cuenta').insert({
      agencia_id: agenciaId,
      tipo: 'cargo',
      monto: 125,
      moneda: 'ARS',
      monto_origen: 185_000,
      cotizacion: 1480,
    })
    expect(completo, completo?.message).toBeNull()
  })
})

describe.skipIf(!hayAnon)('borde público de la conciliación', () => {
  it('anon no lee el extracto bancario del hotel', async () => {
    const { data, error } = await clienteAnonimo()
      .from('movimientos_externos')
      .select('id')
      .limit(1)

    expect(data ?? [], 'anon leyó los movimientos de la cuenta del hotel').toHaveLength(0)
    if (error) expect(['42501', '42P01']).toContain(error.code)
  })
})
