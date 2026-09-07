import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, hayAnon, clienteDePrueba, clienteAnonimo, sufijoUnico } from './db'

/**
 * Comprobantes recibidos (migración 0080, objetivo 9 del pedido).
 *
 * Lo que se prueba acá son las garantías de la **base**: siguen valiendo el día
 * que alguien escriba desde otro lado —un script, el dashboard de Supabase, una
 * acción nueva que se olvide de un campo—.
 */

describe.skipIf(!hayDB)('comprobantes recibidos · lo que garantiza la base', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  // Un CUIT de prueba distinto por corrida: la clave natural es única en todo el
  // país, así que dos corridas con el mismo CUIT chocarían entre sí.
  const cuit = `30${String(Date.now()).slice(-9)}`
  let proveedorId = ''

  const comprobante = (over: Record<string, unknown> = {}) => ({
    cuit_emisor: cuit,
    tipo_codigo: 1,
    letra: 'A',
    punto_venta: 3,
    numero: 1234,
    fecha: '2026-09-05',
    total: 185_000,
    moneda: 'ARS',
    cotizacion: 1,
    cae: '7'.repeat(14),
    ...over,
  })

  beforeAll(async () => {
    db = clienteDePrueba()
    const { data, error } = await db
      .from('proveedores')
      .insert({ nombre: `Proveedor comprobantes ${sufijo}` })
      .select('id')
      .single<{ id: string }>()
    if (error) throw new Error(`no se pudo montar el proveedor: ${error.message}`)
    proveedorId = data.id
  })

  afterAll(async () => {
    await db.from('comprobantes_recibidos').delete().eq('cuit_emisor', cuit)
    await db.from('movimientos_proveedor').delete().eq('proveedor_id', proveedorId)
    await db.from('proveedores').delete().eq('id', proveedorId)
  })

  it('escanear dos veces la misma factura no la carga dos veces', async () => {
    /*
      La garantía central de la 0080.

      Pasa de verdad: la primera foto sale movida, se vuelve a intentar, y sin
      esta restricción el gasto entraría dos veces. La clave es
      `CUIT del emisor + tipo + punto de venta + número`, que identifica un
      comprobante de forma única en todo el país.
    */
    const { error: e1 } = await db.from('comprobantes_recibidos').insert(comprobante())
    expect(e1, `el primero tendría que entrar: ${e1?.message}`).toBeNull()

    const { error: e2 } = await db.from('comprobantes_recibidos').insert(comprobante())
    expect(e2?.code, 'aceptó el mismo comprobante dos veces').toBe('23505')
  })

  it('el mismo número de otro emisor SÍ entra', async () => {
    // Dos proveedores distintos pueden tener la factura 0003-00001234 el mismo
    // día: el CUIT del emisor es lo que las separa.
    const { error } = await db
      .from('comprobantes_recibidos')
      .insert(comprobante({ cuit_emisor: `27${String(Date.now()).slice(-9)}` }))

    expect(error, error?.message).toBeNull()
  })

  it('el mismo número con otra letra también', async () => {
    // Una factura A y una nota de crédito A pueden compartir número: son series
    // distintas. El tipo forma parte de la clave.
    const { error } = await db
      .from('comprobantes_recibidos')
      .insert(comprobante({ tipo_codigo: 3 }))

    expect(error, error?.message).toBeNull()
  })

  it('un CUIT que no es un CUIT se rechaza', async () => {
    // Sin esto, un campo mal cargado rompe la clave natural: el mismo comprobante
    // podría entrar dos veces con «30712345678» y con «30-71234567-8».
    const { error } = await db
      .from('comprobantes_recibidos')
      .insert(comprobante({ cuit_emisor: '30-71234567-8', numero: 9001 }))

    expect(error, 'aceptó un CUIT con guiones').not.toBeNull()
  })

  it('una moneda que el sistema no sabe convertir se rechaza', async () => {
    const { error } = await db
      .from('comprobantes_recibidos')
      .insert(comprobante({ moneda: 'CLP', numero: 9002 }))

    expect(error, 'aceptó una moneda desconocida').not.toBeNull()
  })

  it('un origen inventado se rechaza', async () => {
    // `qr` y `manual` son los dos caminos reales. Si mañana se agrega OCR, entra
    // por una migración y no por una fila con un valor nuevo.
    const { error } = await db
      .from('comprobantes_recibidos')
      .insert(comprobante({ origen_dato: 'ocr', numero: 9003 }))

    expect(error, 'aceptó un origen de dato desconocido').not.toBeNull()
  })

  it('un movimiento no puede quedar respaldado por dos comprobantes', async () => {
    /*
      Sería el mismo gasto contado dos veces.

      Importa por el camino de falla que el propio código documenta: si el asiento
      contable entra y el vínculo no, el comprobante figura sin imputar y alguien
      podría imputarlo de nuevo. Este índice es lo que lo frena.
    */
    const { data: mov, error: eMov } = await db
      .from('movimientos_proveedor')
      .insert({
        proveedor_id: proveedorId,
        tipo: 'cargo',
        monto: 125,
        moneda: 'ARS',
        monto_origen: 185_000,
        cotizacion: 1480,
        concepto: 'Factura A',
      })
      .select('id')
      .single<{ id: string }>()
    if (eMov) throw new Error(`no se pudo montar el movimiento: ${eMov.message}`)

    const { error: e1 } = await db
      .from('comprobantes_recibidos')
      .insert(comprobante({ numero: 9101, movimiento_id: mov.id }))
    expect(e1, `el primer vínculo tendría que entrar: ${e1?.message}`).toBeNull()

    const { error: e2 } = await db
      .from('comprobantes_recibidos')
      .insert(comprobante({ numero: 9102, movimiento_id: mov.id }))
    expect(e2?.code, 'el mismo movimiento quedó respaldado por dos comprobantes').toBe('23505')
  })
})

describe.skipIf(!hayAnon)('borde público de los comprobantes recibidos', () => {
  it('anon no lee las facturas que recibe el hotel', async () => {
    // Llevan el CUIT de cada proveedor y lo que el hotel le paga: es información
    // comercial completa.
    const { data, error } = await clienteAnonimo()
      .from('comprobantes_recibidos')
      .select('id')
      .limit(1)

    expect(data ?? [], 'anon leyó las facturas de proveedores del hotel').toHaveLength(0)
    if (error) expect(['42501', '42P01']).toContain(error.code)
  })
})
