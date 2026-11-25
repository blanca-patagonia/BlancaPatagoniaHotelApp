import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico, periodo } from '../apoyo/db'
import { consultaReservas } from '@/app/(front-gestion)/panel/reservas/consulta'
import { reservasConSaldoVencido } from '@/lib/reservas/atencion'

/**
 * «Requiere atención» del tablero y las vistas del listado que abre.
 *
 * El docente, al probar la demo, tocó «7 reservas con saldo pendiente de cobro»
 * y el enlace abrió el listado entero; lo mismo con «cuentas con consumos sin
 * facturar». Este test fija las dos mitades del arreglo contra Postgres:
 *
 * · Que cada vista traiga exactamente lo que el aviso dice (y no las demás).
 * · Que el tablero y el listado cuenten con la misma consulta, así que el número
 *   del aviso no puede diferir de las filas que se ven.
 *
 * La de «sin facturar» se apoya en el anti-join de PostgREST (`facturas=is.null`)
 * y en `consumos!inner`: si alguno de los dos dejara de filtrar, la vista
 * devolvería reservas que no corresponden sin dar ningún error. Por eso hace
 * falta base real.
 */

const sufijo = sufijoUnico()
const HOY = '2026-11-10'
const AYER = '2026-11-09'
const MANANA = '2026-11-11'

describe.skipIf(!hayDB)('«Requiere atención»: avisos y vistas del listado', () => {
  let db: SupabaseClient
  const ids: Record<string, string> = {}
  const reservas: Record<string, string> = {}
  const unidades: string[] = []
  let facturaId: string | null = null

  async function unidad(n: string): Promise<string> {
    const { data, error } = await db
      .from('unidades')
      .insert({ tipo_unidad_id: ids.tipo, nombre: `Test atención ${n} ${sufijo}` })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear la unidad ${n}: ${error.message}`)
    unidades.push(data!.id)
    return data!.id
  }

  async function crear(clave: string, estado: string, desde: string, hasta: string, total: number) {
    const { data: r, error: eR } = await db
      .from('reservas')
      .insert({ huesped_id: ids.huesped, estado, total, notas: `test-atencion-${sufijo}` })
      .select('id')
      .single()
    if (eR) throw new Error(`No se pudo crear la reserva ${clave}: ${eR.message}`)
    reservas[clave] = r!.id
    const { error: eE } = await db.from('estadias').insert({
      reserva_id: r!.id,
      unidad_id: await unidad(clave),
      tipo_unidad_id: ids.tipo,
      periodo: periodo(desde, hasta),
      estado,
      huespedes: 2,
    })
    if (eE) throw new Error(`No se pudo crear la estadía ${clave}: ${eE.message}`)
  }

  async function consumo(clave: string, importe: number) {
    const { error } = await db
      .from('consumos')
      .insert({ reserva_id: reservas[clave], producto_id: ids.producto, cantidad: 1, precio_unitario: importe })
    if (error) throw new Error(`No se pudo cargar el consumo de ${clave}: ${error.message}`)
  }

  async function pago(clave: string, monto: number) {
    const { error } = await db
      .from('pagos')
      .insert({ reserva_id: reservas[clave], medio: 'efectivo', tipo: 'saldo', monto, estado: 'aprobado' })
    if (error) throw new Error(`No se pudo cargar el pago de ${clave}: ${error.message}`)
  }

  beforeAll(async () => {
    db = clienteDePrueba()
    const { data: tipo, error: eT } = await db
      .from('tipos_unidad')
      .insert({ codigo: `TEST-AT-${sufijo}`, nombre: 'Test atención', categoria: 'hosteria', capacidad_max: 4 })
      .select('id')
      .single()
    if (eT) throw new Error(eT.message)
    ids.tipo = tipo!.id
    const { data: h, error: eH } = await db
      .from('huespedes')
      .insert({ nombre: 'Test', apellido: `Atención ${sufijo}` })
      .select('id')
      .single()
    if (eH) throw new Error(eH.message)
    ids.huesped = h!.id
    const { data: p, error: eP } = await db
      .from('productos_servicios')
      .insert({ codigo: `AT-${sufijo}`, nombre: `Test atención ${sufijo}`, categoria: 'frigobar', precio: 10, stock: 100 })
      .select('id')
      .single()
    if (eP) throw new Error(eP.message)
    ids.producto = p!.id

    // ── Saldo vencido ────────────────────────────────────────────────────
    // Debía llegar ayer y no pagó nada: vencida.
    await crear('confirmadaImpaga', 'confirmada', AYER, '2026-11-13', 100)
    // Debía llegar ayer y pagó todo: no.
    await crear('confirmadaPaga', 'confirmada', AYER, '2026-11-13', 100)
    await pago('confirmadaPaga', 100)
    // Llega mañana sin pagar: es el curso normal, no un aviso.
    await crear('confirmadaFutura', 'confirmada', MANANA, '2026-11-14', 100)
    // Se va hoy: pagó el alojamiento pero no el consumo. La cuenta es la
    // consolidada, así que debe 20.
    await crear('alojadaConConsumo', 'in_house', '2026-11-07', HOY, 50)
    await consumo('alojadaConConsumo', 20)
    await pago('alojadaConConsumo', 50)

    // ── Consumos sin facturar ────────────────────────────────────────────
    await crear('salioSinFactura', 'checkout', '2026-11-05', AYER, 80)
    await consumo('salioSinFactura', 15)
    await crear('salioFacturada', 'checkout', '2026-11-05', AYER, 80)
    await consumo('salioFacturada', 15)
    await crear('salioSinConsumos', 'checkout', '2026-11-05', AYER, 80)
    // Salió hace tres meses: fuera de la ventana de «atender hoy».
    await crear('salioHaceMucho', 'checkout', '2026-08-01', '2026-08-05', 80)
    await consumo('salioHaceMucho', 15)

    const { data: f, error: eF } = await db
      .from('facturas')
      .insert({
        reserva_id: reservas.salioFacturada,
        numero: `AT-TEST-${sufijo}`,
        total: 95,
        tipo_comprobante: 'B',
        neto: 78.51,
        iva: 16.49,
        cae: '7'.repeat(14),
        cae_vto: '2030-12-31',
      })
      .select('id')
      .single()
    if (eF) throw new Error(`No se pudo montar la factura: ${eF.message}`)
    facturaId = f!.id
  }, 60_000)

  afterAll(async () => {
    if (facturaId) await db.from('facturas').delete().eq('id', facturaId)
    for (const id of Object.values(reservas)) {
      await db.from('pagos').delete().eq('reserva_id', id)
      await db.from('consumos').delete().eq('reserva_id', id)
      await db.from('reservas').delete().eq('id', id)
    }
    for (const u of unidades) await db.from('unidades').delete().eq('id', u)
    if (ids.tipo) await db.from('tipos_unidad').delete().eq('id', ids.tipo)
    if (ids.producto) await db.from('productos_servicios').delete().eq('id', ids.producto)
    if (ids.huesped) await db.from('huespedes').delete().eq('id', ids.huesped)
  })

  /** Ids de las reservas de esta corrida, para que la base sembrada no ensucie. */
  const propias = (lista: string[]) => lista.filter((id) => Object.values(reservas).includes(id))

  it('«Saldo pendiente» trae sólo las que ya deberían estar cobradas', async () => {
    const { ids: vencidas, error } = await reservasConSaldoVencido(db, HOY)
    expect(error).toBeNull()
    expect(propias(vencidas).sort()).toEqual([reservas.confirmadaImpaga, reservas.alojadaConConsumo].sort())
  })

  it('el listado con la vista «Saldo pendiente» muestra exactamente esas reservas', async () => {
    const { ids: vencidas } = await reservasConSaldoVencido(db, HOY)
    const { data, count, error } = await consultaReservas(
      db as never,
      { vista: 'por_cobrar', hoy: HOY, idsSaldoVencido: vencidas },
      null,
    )
    expect(error).toBeNull()
    // El aviso dice `vencidas.length`; el listado tiene que tener ese mismo número.
    expect(count).toBe(vencidas.length)
    expect(propias((data ?? []).map((r) => (r as unknown as { id: string }).id)).sort()).toEqual(
      [reservas.confirmadaImpaga, reservas.alojadaConConsumo].sort(),
    )
  })

  it('«Saldo pendiente» sin ninguna vencida no devuelve todo el listado', async () => {
    // Un `in` con la lista vacía tiene que seguir filtrando: si se omitiera el
    // filtro, el listado volvería a mostrar todas las reservas.
    const { count, error } = await consultaReservas(
      db as never,
      { vista: 'por_cobrar', hoy: HOY, idsSaldoVencido: [] },
      null,
    )
    expect(error).toBeNull()
    expect(count).toBe(0)
  })

  it('«Consumos sin facturar» trae las cuentas con consumos y sin factura, y ninguna otra', async () => {
    const { data, error } = await consultaReservas(db as never, { vista: 'sin_facturar', hoy: HOY }, null)
    expect(error).toBeNull()
    const encontradas = propias((data ?? []).map((r) => (r as unknown as { id: string }).id))
    const nombre = (id: string) => Object.entries(reservas).find(([, v]) => v === id)?.[0]
    // Fuera: la facturada (anti-join), la que no consumió nada (`consumos!inner`)
    // y la que salió hace tres meses (ventana). Adentro, además de la que ya se
    // fue, la alojada con consumos: `in_house` es facturable y su cuenta está
    // abierta, que es justo lo que el aviso quiere que no se olvide.
    expect(encontradas.map(nombre).sort()).toEqual(['alojadaConConsumo', 'salioSinFactura'])
  })

  it('el número del aviso es el mismo que las filas de la vista', async () => {
    // Así cuenta el tablero: la misma consulta, con `range(0, 0)`.
    const aviso = await consultaReservas(db as never, { vista: 'sin_facturar', hoy: HOY }, null).range(0, 0)
    const vista = await consultaReservas(db as never, { vista: 'sin_facturar', hoy: HOY }, null)
    expect(aviso.error).toBeNull()
    expect(aviso.count).toBe((vista.data ?? []).length)
  })
})
