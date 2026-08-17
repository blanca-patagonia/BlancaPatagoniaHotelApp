import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'
import { guardarEntrantes, importarEntrante } from '@/lib/canales/servicio'
import type { ReservaDeCanal } from '@/lib/canales'

/**
 * Test de integración de la capa de canales.
 *
 * ── Qué se verifica y por qué contra base real ──────────────────────────────
 *
 * Las reglas puras ya están cubiertas (`canales.test.ts`, `canal-csv.test.ts`,
 * `canal-ical.test.ts`). Lo que sólo se puede verificar con Postgres es el
 * comportamiento que **depende de la base**, y son justo los casos que importan:
 *
 * · **Idempotencia**: reimportar el mismo informe no duplica.
 * · **Orden de eventos**: un evento viejo que llega tarde no pisa al nuevo.
 * · **El choque con el anti-overbooking**: si el canal vendió una unidad que ya
 *   estaba vendida, la restricción de exclusión (ADR 0002) rechaza — y la reserva
 *   entrante tiene que quedar en `error` **con el motivo escrito**, no desaparecer.
 *   Es la razón de existir de la zona de recepción.
 * · **El precio lo pone el hotel**: el total de la reserva creada sale del
 *   tarifario propio, no del importe que informó el canal.
 */

const sufijo = sufijoUnico()

/** Fechas del caso principal. Caen en una temporada que el seed ya cubre. */
const FECHA_ENTRADA = '2027-03-10'
const FECHA_SALIDA = '2027-03-13'

/** Perfil ficticio para `importada_por`. Se usa el admin sembrado si existe. */
let perfilId = ''

function entrante(over: Partial<ReservaDeCanal> = {}): ReservaDeCanal {
  return {
    externalId: `BK-${sufijo}-1`,
    canal: 'booking',
    tipoUnidadCodigo: `TEST-CAN-${sufijo}`,
    checkIn: FECHA_ENTRADA,
    checkOut: FECHA_SALIDA,
    huespedes: 2,
    huesped: {
      apellido: `Canal${sufijo}`,
      nombre: 'Ana',
      email: `canal-${sufijo}@example.com`,
      telefono: '+5492901000000',
      pais: 'AR',
    },
    importeCanal: 300,
    monedaCanal: 'USD',
    comision: 45,
    notas: 'Llegada tardía',
    operacion: 'nueva',
    emitidaEn: '2027-01-15T10:00:00.000Z',
    ...over,
  }
}

describe.skipIf(!hayDB)('capa de canales contra la base', () => {
  let db: SupabaseClient
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: tipo } = await db
      .from('tipos_unidad')
      .insert({
        codigo: `TEST-CAN-${sufijo}`,
        nombre: 'Test canal',
        categoria: 'hosteria',
        capacidad_max: 4,
      })
      .select('id')
      .single()
    ids.tipo = tipo!.id

    // Una sola unidad: así el segundo intento sobre las mismas fechas choca con el
    // anti-overbooking, que es lo que hay que probar.
    const { data: unidad } = await db
      .from('unidades')
      .insert({ tipo_unidad_id: ids.tipo, nombre: `Test canal ${sufijo}` })
      .select('id')
      .single()
    ids.unidad = unidad!.id

    // Tarifa para que la cotización no falle por falta de precio.
    //
    // NO se crea una temporada nueva: `temporada_rangos` tiene una restricción de
    // exclusión que prohíbe rangos solapados, y el seed ya cubre 2027. Se usa la
    // temporada que rige en las fechas del test y se le carga una tarifa para el
    // tipo de unidad de prueba. `tarifas` es único por (tipo, temporada), así que
    // no puede chocar con nada existente.
    const { data: temporadaId, error: eTemporada } = await db.rpc('temporada_en', {
      f: FECHA_ENTRADA,
    })
    if (eTemporada || !temporadaId) {
      throw new Error(
        `No hay temporada cargada para ${FECHA_ENTRADA}: el seed cambió y hay que ajustar el test.`,
      )
    }
    ids.temporada = temporadaId as string

    const { error: eTarifa } = await db.from('tarifas').insert({
      tipo_unidad_id: ids.tipo,
      temporada_id: ids.temporada,
      precio_neto: 80,
      precio_rack: 100,
    })
    if (eTarifa) throw new Error(`No se pudo cargar la tarifa de prueba: ${eTarifa.message}`)

    const { data: perfil } = await db.from('perfiles').select('id').limit(1).maybeSingle()
    perfilId = perfil?.id ?? '00000000-0000-0000-0000-000000000000'
  })

  afterAll(async () => {
    // Las reservas creadas por la importación se borran por el huésped, que
    // cascadea. Después el resto, en orden de dependencia.
    const { data: entrantes } = await db
      .from('canal_reservas')
      .select('reserva_id')
      .like('external_id', `BK-${sufijo}%`)

    for (const e of (entrantes ?? []) as { reserva_id: string | null }[]) {
      if (e.reserva_id) await db.from('reservas').delete().eq('id', e.reserva_id)
    }

    // Los cargos de comisión que devenga `guardarEntrantes` desde la migración 0049.
    // Van ANTES de borrar las entrantes: `canal_cargos.canal_reserva_id` es
    // `on delete set null`, así que si se borra primero la entrante estos cargos
    // quedan huérfanos y sin forma de identificarlos. La clave de idempotencia lleva
    // el `external_id`, que sí tiene el sufijo del test.
    await db.from('canal_cargos').delete().like('clave_idempotencia', `%BK-${sufijo}%`)

    await db.from('canal_reservas').delete().like('external_id', `BK-${sufijo}%`)
    await db.from('canal_sincronizaciones').delete().like('origen', `test-${sufijo}%`)
    await db.from('huespedes').delete().like('apellido', `Canal${sufijo}%`)
    if (ids.tipo) await db.from('tarifas').delete().eq('tipo_unidad_id', ids.tipo)
    if (ids.unidad) await db.from('unidades').delete().eq('id', ids.unidad)
    if (ids.tipo) await db.from('tipos_unidad').delete().eq('id', ids.tipo)
  })

  const contexto = {
    canal: 'booking' as const,
    proveedor: 'csv',
    origen: `test-${sufijo}`,
    perfilId: undefined as string | undefined,
  }

  it('aterriza una entrante nueva sin crear reserva', async () => {
    const r = await guardarEntrantes(db, [entrante()], contexto)

    expect(r.nuevas).toBe(1)
    expect(r.rechazadas).toBe(0)

    const { data } = await db
      .from('canal_reservas')
      .select('estado, reserva_id, huesped_apellido, importe_canal')
      .eq('external_id', `BK-${sufijo}-1`)
      .single()

    expect(data!.estado).toBe('pendiente')
    // Lo importante: NO creó reserva. No ocupa inventario hasta que alguien la
    // importe.
    expect(data!.reserva_id).toBeNull()
    expect(Number(data!.importe_canal)).toBe(300)
  })

  it('reimportar el mismo informe no duplica', async () => {
    // Es el caso normal: quien baja el informe el lunes y el martes trae las
    // mismas reservas de la semana.
    const r = await guardarEntrantes(db, [entrante()], contexto)

    expect(r.nuevas).toBe(0)

    const { count } = await db
      .from('canal_reservas')
      .select('id', { count: 'exact', head: true })
      .eq('external_id', `BK-${sufijo}-1`)

    expect(count).toBe(1)
  })

  it('un evento MÁS NUEVO actualiza la fila', async () => {
    const r = await guardarEntrantes(
      db,
      [entrante({ huespedes: 3, emitidaEn: '2027-01-20T10:00:00.000Z' })],
      contexto,
    )

    expect(r.actualizadas).toBe(1)

    const { data } = await db
      .from('canal_reservas')
      .select('huespedes')
      .eq('external_id', `BK-${sufijo}-1`)
      .single()

    expect(data!.huespedes).toBe(3)
  })

  it('un evento VIEJO que llega tarde NO pisa al nuevo', async () => {
    // Los canales no garantizan el orden de entrega. Sin esta comprobación, un
    // reenvío tardío revertiría el estado correcto.
    const r = await guardarEntrantes(
      db,
      [entrante({ huespedes: 1, emitidaEn: '2027-01-01T10:00:00.000Z' })],
      contexto,
    )

    expect(r.actualizadas).toBe(0)

    const { data } = await db
      .from('canal_reservas')
      .select('huespedes')
      .eq('external_id', `BK-${sufijo}-1`)
      .single()

    // Sigue siendo 3, el valor del evento más nuevo.
    expect(data!.huespedes).toBe(3)
  })

  it('rechaza una entrante inválida sin tocar la base', async () => {
    const r = await guardarEntrantes(db, [entrante({ externalId: '   ' })], contexto)

    expect(r.rechazadas).toBe(1)
    expect(r.nuevas).toBe(0)
    expect(r.motivos.join(' ')).toContain('identificador del canal')
  })

  it('registra la sincronización incluso cuando no entró nada', async () => {
    // «Se sincronizó y no había nada nuevo» es una respuesta distinta de «no se
    // sincronizó», y es la primera pregunta cuando falta una reserva.
    await guardarEntrantes(db, [], contexto)

    const { data } = await db
      .from('canal_sincronizaciones')
      .select('leidas, nuevas, proveedor')
      .eq('origen', `test-${sufijo}`)
      .order('corrida_en', { ascending: false })
      .limit(1)
      .single()

    expect(data!.proveedor).toBe('csv')
    expect(data!.leidas).toBe(0)
  })

  it('importar crea la reserva y la deja conciliada', async () => {
    const { data: e } = await db
      .from('canal_reservas')
      .select('id')
      .eq('external_id', `BK-${sufijo}-1`)
      .single()

    const r = await importarEntrante(db, e!.id, perfilId)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const { data: fila } = await db
      .from('canal_reservas')
      .select('estado, reserva_id, importada_en')
      .eq('id', e!.id)
      .single()

    expect(fila!.estado).toBe('importada')
    expect(fila!.reserva_id).toBe(r.reservaId)
    expect(fila!.importada_en).not.toBeNull()
  })

  it('la reserva creada entra CONFIRMADA, no pendiente', async () => {
    // Si entrara como pendiente, la expiración automática de la migración 0011 la
    // borraría en 5 días y liberaría una unidad YA VENDIDA por el canal.
    const { data } = await db
      .from('canal_reservas')
      .select('reserva:reservas(estado, canal, tarifa_tipo, total)')
      .eq('external_id', `BK-${sufijo}-1`)
      .single()

    const reserva = (data as unknown as { reserva: { estado: string; canal: string; tarifa_tipo: string; total: number | string } }).reserva
    expect(reserva.estado).toBe('confirmada')
    expect(reserva.canal).toBe('booking')
    // Venta por OTA = venta de agencia = tarifa neto (ADR 0004).
    expect(reserva.tarifa_tipo).toBe('neto')
  })

  it('el precio sale del tarifario del hotel, NO del importe del canal', async () => {
    // ADR 0004: el precio lo fija el hotel. El canal informó 300; el tarifario da
    // 3 noches × 80 neto + IVA 21% = 290,40.
    const { data } = await db
      .from('canal_reservas')
      .select('importe_canal, motivo, reserva:reservas(total)')
      .eq('external_id', `BK-${sufijo}-1`)
      .single()

    const total = Number(
      (data as unknown as { reserva: { total: number | string } }).reserva.total,
    )
    expect(total).toBeCloseTo(290.4, 1)
    expect(Number(data!.importe_canal)).toBe(300)
    expect(total).not.toBe(300)
  })

  it('avisa la discrepancia entre lo que informa el canal y la cuenta del hotel', async () => {
    const { data } = await db
      .from('canal_reservas')
      .select('motivo')
      .eq('external_id', `BK-${sufijo}-1`)
      .single()

    // 300 contra 290,40: la diferencia supera la tolerancia, así que queda anotada.
    expect(data!.motivo).toContain('El canal informa')
  })

  it('no se puede importar dos veces la misma', async () => {
    const { data: e } = await db
      .from('canal_reservas')
      .select('id')
      .eq('external_id', `BK-${sufijo}-1`)
      .single()

    const r = await importarEntrante(db, e!.id, perfilId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ya se importó')
  })

  it('EL CASO CLAVE: si el canal sobrevendió, queda en error con el motivo escrito', async () => {
    // Hay UNA sola unidad de este tipo y ya está ocupada esas fechas por la
    // importación anterior. La restricción de exclusión (ADR 0002) va a rechazar,
    // y eso es correcto. Lo que no puede pasar es que la reserva desaparezca: es
    // exactamente la razón por la que existe la zona de recepción.
    await guardarEntrantes(
      db,
      [
        entrante({
          externalId: `BK-${sufijo}-2`,
          huesped: {
            apellido: `Canal${sufijo}Dos`,
            nombre: 'Bruno',
            email: `canal2-${sufijo}@example.com`,
            telefono: null,
            pais: 'BR',
          },
        }),
      ],
      contexto,
    )

    const { data: e } = await db
      .from('canal_reservas')
      .select('id')
      .eq('external_id', `BK-${sufijo}-2`)
      .single()

    const r = await importarEntrante(db, e!.id, perfilId)
    expect(r.ok).toBe(false)

    const { data: fila } = await db
      .from('canal_reservas')
      .select('estado, motivo, reserva_id')
      .eq('id', e!.id)
      .single()

    expect(fila!.estado).toBe('error')
    expect(fila!.motivo.length).toBeGreaterThan(0)
    expect(fila!.reserva_id).toBeNull()
  })

  it('una entrante con un tipo de unidad desconocido explica qué falta', async () => {
    await guardarEntrantes(
      db,
      [
        entrante({
          externalId: `BK-${sufijo}-3`,
          tipoUnidadCodigo: 'TIPO-QUE-NO-EXISTE',
          checkIn: '2027-05-01',
          checkOut: '2027-05-03',
        }),
      ],
      contexto,
    )

    const { data: e } = await db
      .from('canal_reservas')
      .select('id')
      .eq('external_id', `BK-${sufijo}-3`)
      .single()

    const r = await importarEntrante(db, e!.id, perfilId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('TIPO-QUE-NO-EXISTE')

    const { data: fila } = await db
      .from('canal_reservas')
      .select('estado, motivo')
      .eq('id', e!.id)
      .single()

    expect(fila!.estado).toBe('error')
    // El mensaje tiene que decir qué hacer, no sólo que falló.
    expect(fila!.motivo).toContain('Creá ese tipo de unidad')
  })

  it('una cancelada del canal no crea reserva y queda ignorada', async () => {
    await guardarEntrantes(
      db,
      [
        entrante({
          externalId: `BK-${sufijo}-4`,
          operacion: 'cancelada',
          checkIn: '2027-06-01',
          checkOut: '2027-06-03',
        }),
      ],
      contexto,
    )

    const { data: e } = await db
      .from('canal_reservas')
      .select('id')
      .eq('external_id', `BK-${sufijo}-4`)
      .single()

    const r = await importarEntrante(db, e!.id, perfilId)
    expect(r.ok).toBe(false)

    const { data: fila } = await db
      .from('canal_reservas')
      .select('estado, reserva_id')
      .eq('id', e!.id)
      .single()

    // `ignorada` y no `error`: no hay nada que arreglar.
    expect(fila!.estado).toBe('ignorada')
    expect(fila!.reserva_id).toBeNull()
  })

  it('reusa la ficha del huésped si el email ya existe', async () => {
    // Se busca por email y sólo por email: por apellido se fusionarían dos
    // personas distintas, que es peor que tener dos fichas de la misma.
    const { count } = await db
      .from('huespedes')
      .select('id', { count: 'exact', head: true })
      .eq('email', `canal-${sufijo}@example.com`)

    expect(count).toBe(1)
  })
})
