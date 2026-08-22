import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'
import { guardarEntrantes, importarEntrante } from '@/lib/canales/servicio'
import { claveDeCargo } from '@/lib/domain/canales-costos'
import type { ReservaDeCanal } from '@/lib/canales'

/**
 * La contabilidad de la comisión, contra Postgres.
 *
 * Las reglas puras están en `canales-costos.test.ts`. Lo que sólo se puede verificar
 * con la base es lo que la base garantiza:
 *
 * · **La convivencia informe / factura.** Es la decisión central de la migración
 *   0049: la comisión que informó el archivo de reservas y la que después cobró la
 *   factura mensual son dos filas sobre la misma reserva, y **no se pisan**. Si se
 *   pisaran, la conciliación sería imposible porque el dato con el que hay que
 *   comparar ya no estaría.
 * · **La idempotencia.** Reimportar el mismo informe no duplica el devengo. Es lo
 *   que más se va a hacer en producción: el informe del extranet se baja completo
 *   cada vez, no incremental.
 * · **El vínculo con la reserva.** El cargo nace con `canal_reserva_id` pero sin
 *   `reserva_id`, porque al aterrizar la reserva todavía no existe. Recién al
 *   importar se completa, y es lo que permite responder «cuánto me costó esta venta».
 */

const sufijo = sufijoUnico()

const FECHA_ENTRADA = '2027-04-12'
const FECHA_SALIDA = '2027-04-15'

const REF = `BKC-${sufijo}-1`

function entrante(over: Partial<ReservaDeCanal> = {}): ReservaDeCanal {
  return {
    externalId: REF,
    canal: 'booking',
    tipoUnidadCodigo: `TEST-CAR-${sufijo}`,
    checkIn: FECHA_ENTRADA,
    checkOut: FECHA_SALIDA,
    huespedes: 2,
    huesped: {
      apellido: `Cargo${sufijo}`,
      nombre: 'Ana',
      email: `cargo-${sufijo}@example.com`,
      telefono: null,
      pais: 'AR',
    },
    importeCanal: 300,
    monedaCanal: 'USD',
    comision: 45,
    notas: '',
    operacion: 'nueva',
    emitidaEn: '2027-02-01T10:00:00.000Z',
    ...over,
  }
}

interface FilaCargo {
  id: string
  origen: string
  concepto: string
  monto: number | string
  moneda: string
  imputado_el: string | null
  canal_reserva_id: string | null
  reserva_id: string | null
  estado_conciliacion: string
}

describe.skipIf(!hayDB)('contabilidad de la comisión del canal', () => {
  let db: SupabaseClient
  const ids: Record<string, string> = {}
  let perfilId = ''

  const contexto = {
    canal: 'booking' as const,
    proveedor: 'csv',
    origen: `test-cargos-${sufijo}`,
    perfilId: undefined as string | undefined,
  }

  /** Los cargos de este test, identificados por el sufijo en la clave. */
  async function cargosDelTest(): Promise<FilaCargo[]> {
    const { data, error } = await db
      .from('canal_cargos')
      .select(
        'id, origen, concepto, monto, moneda, imputado_el, canal_reserva_id, reserva_id, estado_conciliacion',
      )
      .like('clave_idempotencia', `%${sufijo}%`)
      .order('origen')
    if (error) throw new Error(`No se pudieron leer los cargos: ${error.message}`)
    return (data ?? []) as FilaCargo[]
  }

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: tipo, error: eTipo } = await db
      .from('tipos_unidad')
      .insert({
        codigo: `TEST-CAR-${sufijo}`,
        nombre: 'Test cargos',
        categoria: 'hosteria',
        capacidad_max: 4,
      })
      .select('id')
      .single()
    if (eTipo) throw new Error(`No se pudo crear el tipo: ${eTipo.message}`)
    ids.tipo = tipo!.id

    const { data: unidad, error: eUnidad } = await db
      .from('unidades')
      .insert({ tipo_unidad_id: ids.tipo, nombre: `Test cargos ${sufijo}` })
      .select('id')
      .single()
    if (eUnidad) throw new Error(`No se pudo crear la unidad: ${eUnidad.message}`)
    ids.unidad = unidad!.id

    // Se reusa la temporada vigente en vez de crear una: `temporada_rangos` tiene
    // una restricción de exclusión que prohíbe rangos solapados.
    const { data: temporadaId, error: eTemporada } = await db.rpc('temporada_en', {
      f: FECHA_ENTRADA,
    })
    if (eTemporada || !temporadaId) {
      throw new Error(`No hay temporada cargada para ${FECHA_ENTRADA}: el seed cambió.`)
    }
    ids.temporada = temporadaId as string

    const { error: eTarifa } = await db.from('tarifas').insert({
      tipo_unidad_id: ids.tipo,
      temporada_id: ids.temporada,
      precio_neto: 80,
      precio_rack: 100,
    })
    if (eTarifa) throw new Error(`No se pudo cargar la tarifa: ${eTarifa.message}`)

    const { data: perfil } = await db.from('perfiles').select('id').limit(1).maybeSingle()
    perfilId = perfil?.id ?? '00000000-0000-0000-0000-000000000000'
  })

  afterAll(async () => {
    // Los cargos primero: `canal_reserva_id` es `on delete set null`, así que si se
    // borra la entrante antes, quedan huérfanos y sin forma de identificarlos.
    await db.from('canal_cargos').delete().like('clave_idempotencia', `%${sufijo}%`)

    const { data: entrantes } = await db
      .from('canal_reservas')
      .select('reserva_id')
      .like('external_id', `BKC-${sufijo}%`)
    for (const e of (entrantes ?? []) as { reserva_id: string | null }[]) {
      if (e.reserva_id) await db.from('reservas').delete().eq('id', e.reserva_id)
    }

    await db.from('canal_reservas').delete().like('external_id', `BKC-${sufijo}%`)
    await db.from('canal_sincronizaciones').delete().like('origen', `test-cargos-${sufijo}%`)
    await db.from('huespedes').delete().like('apellido', `Cargo${sufijo}%`)
    if (ids.tipo) await db.from('tarifas').delete().eq('tipo_unidad_id', ids.tipo)
    if (ids.unidad) await db.from('unidades').delete().eq('id', ids.unidad)
    if (ids.tipo) await db.from('tipos_unidad').delete().eq('id', ids.tipo)
  })

  it('aterrizar una entrante devenga su comisión', async () => {
    await guardarEntrantes(db, [entrante()], contexto)

    const cargos = await cargosDelTest()
    expect(cargos).toHaveLength(1)
    expect(cargos[0].concepto).toBe('comision')
    expect(cargos[0].origen).toBe('informe_reservas')
    expect(Number(cargos[0].monto)).toBe(45)
    expect(cargos[0].moneda).toBe('USD')
    expect(cargos[0].estado_conciliacion).toBe('devengado')
  })

  it('imputa la comisión a la fecha de SALIDA', async () => {
    // El default de `canal_config.imputa_por` es `salida`: la comisión se devenga
    // cuando se consume la estadía, que es con qué criterio factura el canal el mes
    // siguiente. Imputar por entrada desalinearía nuestro mes contra su factura.
    const cargos = await cargosDelTest()
    expect(cargos[0].imputado_el).toBe(FECHA_SALIDA)
  })

  it('el cargo nace ligado a la entrante y TODAVÍA no a la reserva', async () => {
    // Al aterrizar la reserva propia no existe: `reserva_id` no puede estar puesto.
    const cargos = await cargosDelTest()
    expect(cargos[0].canal_reserva_id).not.toBeNull()
    expect(cargos[0].reserva_id).toBeNull()
  })

  it('reaterrizar el mismo informe NO duplica el devengo', async () => {
    // El informe del extranet se baja completo cada vez, no incremental: esto es lo
    // que más va a pasar en producción.
    await guardarEntrantes(db, [entrante()], contexto)
    await guardarEntrantes(db, [entrante()], contexto)

    expect(await cargosDelTest()).toHaveLength(1)
  })

  it('si el canal CORRIGE la comisión, el devengo se actualiza', async () => {
    // Un evento posterior con otra comisión tiene que reflejarse: si no, la cuenta
    // se queda con el dato viejo y la factura no cierra.
    await guardarEntrantes(
      db,
      [entrante({ comision: 52.75, emitidaEn: '2027-02-10T10:00:00.000Z' })],
      contexto,
    )

    const cargos = await cargosDelTest()
    expect(cargos).toHaveLength(1)
    expect(Number(cargos[0].monto)).toBe(52.75)
  })

  it('importar completa el vínculo del cargo con la reserva', async () => {
    const { data: entranteFila } = await db
      .from('canal_reservas')
      .select('id')
      .eq('external_id', REF)
      .single()

    const r = await importarEntrante(db, (entranteFila as { id: string }).id, perfilId)
    expect(r.ok, 'no se pudo importar: ' + (r.ok ? '' : r.error)).toBe(true)

    const cargos = await cargosDelTest()
    expect(cargos[0].reserva_id).not.toBeNull()
    if (r.ok) expect(cargos[0].reserva_id).toBe(r.reservaId)
  })

  it('el informe y la factura CONVIVEN sobre la misma reserva', async () => {
    // La decisión central de la 0049. La factura mensual llega después y con otro
    // importe; las dos filas tienen que quedar, porque compararlas es la
    // conciliación. Si compartieran clave, la segunda borraría a la primera.
    const { error } = await db.from('canal_cargos').insert({
      canal: 'booking',
      concepto: 'comision',
      origen: 'factura_comision',
      monto: 55.3,
      imputado_el: FECHA_SALIDA,
      clave_idempotencia: claveDeCargo('factura_comision', 'comision', REF),
    })
    expect(error, 'la factura no pudo convivir con el informe').toBeNull()

    const cargos = await cargosDelTest()
    expect(cargos).toHaveLength(2)

    const porOrigen = Object.fromEntries(cargos.map((c) => [c.origen, Number(c.monto)]))
    expect(porOrigen['informe_reservas']).toBe(52.75)
    expect(porOrigen['factura_comision']).toBe(55.3)
  })

  it('la MISMA fuente sobre la misma reserva sí rebota', async () => {
    // La otra mitad de la garantía: convivir no es lo mismo que duplicar.
    const { error } = await db.from('canal_cargos').insert({
      canal: 'booking',
      concepto: 'comision',
      origen: 'factura_comision',
      monto: 999,
      clave_idempotencia: claveDeCargo('factura_comision', 'comision', REF),
    })
    expect(error?.code, 'la restricción única no rechazó el duplicado').toBe('23505')
  })

  it('una entrante CANCELADA no devenga nada', async () => {
    const ref = `BKC-${sufijo}-cancel`
    await guardarEntrantes(
      db,
      [entrante({ externalId: ref, operacion: 'cancelada' })],
      contexto,
    )

    const { data } = await db
      .from('canal_cargos')
      .select('id')
      .eq('clave_idempotencia', claveDeCargo('informe_reservas', 'comision', ref))
    expect(data ?? []).toHaveLength(0)
  })

  it('una entrante SIN comisión informada no devenga nada', async () => {
    // Es el caso del feed iCal, que nunca la trae. Devengar cero afirmaría que el
    // canal no cobró nada, que es falso.
    const ref = `BKC-${sufijo}-icalsin`
    await guardarEntrantes(db, [entrante({ externalId: ref, comision: null })], contexto)

    const { data } = await db
      .from('canal_cargos')
      .select('id')
      .eq('clave_idempotencia', claveDeCargo('informe_reservas', 'comision', ref))
    expect(data ?? []).toHaveLength(0)
  })

  it('la vista de conciliación agrupa por mes y por origen', async () => {
    const { data, error } = await db
      .from('conciliacion_comision_canal')
      .select('canal, mes, origen, cargos, total')
      .eq('canal', 'booking')
      .eq('mes', '2027-04-01')

    if (error) throw new Error(`No se pudo leer la vista: ${error.message}`)

    const filas = (data ?? []) as { origen: string; cargos: number; total: number | string }[]
    const origenes = filas.map((f) => f.origen).sort()
    expect(origenes).toContain('informe_reservas')
    expect(origenes).toContain('factura_comision')

    // Y las dos son comparables: es lo que hace de esto una conciliación.
    const informe = filas.find((f) => f.origen === 'informe_reservas')
    const factura = filas.find((f) => f.origen === 'factura_comision')
    expect(Number(informe!.total)).toBe(52.75)
    expect(Number(factura!.total)).toBe(55.3)
  })
})
