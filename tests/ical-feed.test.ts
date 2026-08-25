import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'

/**
 * El handler del feed iCal, contra la base de verdad.
 *
 * ── Por qué no alcanza con el test de la función pura ───────────────────────
 *
 * `ical-saliente.test.ts` verifica que `generarIcal` no escriba datos personales,
 * pero lo hace contra datos que le pasa el propio test: prueba que la función no
 * inventa un apellido, no que el handler no se lo pase. La fuga posible está en el
 * medio —un `select` que trae de más, un nombre de calendario armado con el nombre
 * del huésped— y eso sólo se ve sembrando un huésped real y leyendo la respuesta.
 *
 * Acá se siembra un apellido, un correo, un código de reserva y un importe, y se
 * exige que **ninguno** aparezca en el cuerpo.
 *
 * ── Y la regla que puede costar plata ───────────────────────────────────────
 *
 * Que una unidad vendida no cierre el tipo entero cuando queda otra libre. Se prueba
 * de punta a punta: mismo pedido, misma fecha, se agrega una segunda unidad al tipo
 * y el bloqueo tiene que desaparecer.
 */

// `permitirIntento` lee las cabeceras de la petición. Sin contexto de Next eso
// revienta; con unas cabeceras vacías no hay IP, el limitador deja pasar —igual que
// en producción detrás de un proxy que no las manda— y no escribe en la base.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const sufijo = sufijoUnico()
const APELLIDO = `IcalSecreto${sufijo}`
const CORREO = `ical-${sufijo}@example.com`
const TOTAL = 987654.32

/** Fechas lejos de los datos de demo, dentro de la ventana de un año del feed. */
const DESDE = '2027-06-01'
const HASTA = '2027-06-04'

describe.skipIf(!hayDB)('feed iCal de salida', () => {
  let db: SupabaseClient
  let GET: typeof import('@/app/api/canales/ical/[token]/route').GET

  let tipoId = ''
  let unidadId = ''
  let unidadExtraId = ''
  let huespedId = ''
  let reservaId = ''
  let codigoReserva = ''
  let tokenReserva = ''
  let token = ''
  /** `true` si esta suite creó la fila de `canal_config`, para no borrar una ajena. */
  let configPropia = false

  async function pedir(consulta: string, elToken = token): Promise<Response> {
    return GET(new Request(`http://localhost/api/canales/ical/${elToken}${consulta}`), {
      params: Promise.resolve({ token: elToken }),
    })
  }

  beforeAll(async () => {
    // El cliente admin del handler pide `NEXT_PUBLIC_SUPABASE_URL`; los tests exportan
    // `SUPABASE_URL`. En CI están las dos, en local puede faltar una.
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL
    ;({ GET } = await import('@/app/api/canales/ical/[token]/route'))

    db = clienteDePrueba()

    // Tipo y unidad propios: depender del inventario de demo ataría el resultado a
    // cuántas unidades tenga cargadas el tipo que se hubiera elegido.
    const { data: tipo, error: eTipo } = await db
      .from('tipos_unidad')
      .insert({
        codigo: `TEST-ICAL-${sufijo}`,
        nombre: `Test iCal ${sufijo}`,
        categoria: 'hosteria',
        capacidad_max: 2,
      })
      .select('id')
      .single<{ id: string }>()
    if (eTipo) throw new Error(`No se pudo crear el tipo: ${eTipo.message}`)
    tipoId = tipo.id

    const { data: unidad, error: eUnidad } = await db
      .from('unidades')
      .insert({ tipo_unidad_id: tipoId, nombre: `TestIcal-${sufijo}` })
      .select('id')
      .single<{ id: string }>()
    if (eUnidad) throw new Error(`No se pudo crear la unidad: ${eUnidad.message}`)
    unidadId = unidad.id

    const { data: huesped, error: eHuesped } = await db
      .from('huespedes')
      .insert({ nombre: 'Ignacio', apellido: APELLIDO, email: CORREO })
      .select('id')
      .single<{ id: string }>()
    if (eHuesped) throw new Error(`No se pudo crear el huésped: ${eHuesped.message}`)
    huespedId = huesped.id

    const { data: reserva, error: eReserva } = await db
      .from('reservas')
      .insert({ huesped_id: huespedId, estado: 'confirmada', total: TOTAL })
      .select('id, codigo, token')
      .single<{ id: string; codigo: string; token: string }>()
    if (eReserva) throw new Error(`No se pudo crear la reserva: ${eReserva.message}`)
    reservaId = reserva.id
    codigoReserva = reserva.codigo
    tokenReserva = reserva.token

    const { error: eEstadia } = await db.from('estadias').insert({
      reserva_id: reservaId,
      unidad_id: unidadId,
      tipo_unidad_id: tipoId,
      periodo: `[${DESDE},${HASTA})`,
      estado: 'confirmada',
      precio_noche: 100,
      huespedes: 1,
    })
    if (eEstadia) throw new Error(`No se pudo crear la estadía: ${eEstadia.message}`)

    // La configuración del canal, que es de donde sale el token del feed.
    const { data: existente } = await db
      .from('canal_config')
      .select('canal, ical_token')
      .eq('canal', 'booking')
      .maybeSingle<{ canal: string; ical_token: string }>()

    if (existente) {
      token = existente.ical_token
    } else {
      const { data: creada, error: eConfig } = await db
        .from('canal_config')
        .insert({ canal: 'booking' })
        .select('ical_token')
        .single<{ ical_token: string }>()
      if (eConfig) throw new Error(`No se pudo crear canal_config: ${eConfig.message}`)
      token = creada.ical_token
      configPropia = true
    }
  }, 60_000)

  afterAll(async () => {
    // En orden inverso a la creación: las claves foráneas son `on delete restrict`.
    await db.from('estadias').delete().eq('reserva_id', reservaId)
    await db.from('reservas').delete().eq('id', reservaId)
    await db.from('huespedes').delete().eq('id', huespedId)
    if (unidadExtraId) await db.from('unidades').delete().eq('id', unidadExtraId)
    await db.from('unidades').delete().eq('id', unidadId)
    await db.from('tipos_unidad').delete().eq('id', tipoId)
    if (configPropia) await db.from('canal_config').delete().eq('canal', 'booking')
  })

  it('publica las noches vendidas del tipo', async () => {
    const r = await pedir(`?tipo=TEST-ICAL-${sufijo}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/calendar')
    expect(r.headers.get('cache-control')).toBe('no-store')

    const cuerpo = await r.text()
    expect(cuerpo).toContain('DTSTART;VALUE=DATE:20270601')
    expect(cuerpo).toContain('DTEND;VALUE=DATE:20270604')
  })

  it('EL CONTRATO: el cuerpo no trae ni un dato del huésped ni de la reserva', async () => {
    const cuerpo = await (await pedir(`?tipo=TEST-ICAL-${sufijo}`)).text()

    expect(cuerpo, 'se filtró el apellido del huésped').not.toContain(APELLIDO)
    expect(cuerpo, 'se filtró el correo del huésped').not.toContain(CORREO)
    expect(cuerpo, 'se filtró el código de la reserva').not.toContain(codigoReserva)
    expect(cuerpo, 'se filtró el token de la reserva').not.toContain(tokenReserva)
    expect(cuerpo, 'se filtró el importe').not.toContain('987654')
    expect(cuerpo).toContain('SUMMARY:Ocupado')
  })

  it('registra la lectura, que es lo más parecido a un acuse que da el iCal', async () => {
    await db.from('canal_config').update({ ical_leido_en: null }).eq('canal', 'booking')
    await pedir(`?tipo=TEST-ICAL-${sufijo}`)

    const { data } = await db
      .from('canal_config')
      .select('ical_leido_en')
      .eq('canal', 'booking')
      .single<{ ical_leido_en: string | null }>()

    expect(data?.ical_leido_en, 'no quedó registrada la lectura del feed').not.toBeNull()
  })

  it('LA REGLA QUE CUESTA PLATA: con otra unidad libre, el tipo NO se cierra', async () => {
    // Misma estadía, misma fecha. Lo único que cambia es que el tipo pasa a tener dos
    // unidades: cerrar igual sería dejar de vender una habitación disponible.
    const { data: extra, error } = await db
      .from('unidades')
      .insert({ tipo_unidad_id: tipoId, nombre: `TestIcalExtra-${sufijo}` })
      .select('id')
      .single<{ id: string }>()
    if (error) throw new Error(`No se pudo crear la unidad extra: ${error.message}`)
    unidadExtraId = extra.id

    const cuerpo = await (await pedir(`?tipo=TEST-ICAL-${sufijo}`)).text()

    expect(cuerpo, 'cerró el tipo entero con una unidad libre').not.toContain('BEGIN:VEVENT')
  })

  it('el feed por unidad SÍ marca esa unidad como ocupada', async () => {
    // El caso en que el iCal rinde de verdad: cada unidad es una habitación separada
    // en el extranet, así que su calendario es sólo suyo.
    const cuerpo = await (await pedir(`?unidad=TestIcal-${sufijo}`)).text()

    expect(cuerpo).toContain('DTSTART;VALUE=DATE:20270601')
    expect(cuerpo).not.toContain(APELLIDO)
  })

  it('un token inexistente da 404, no 401', async () => {
    // Un 401 confirmaría que la ruta existe y que el token tenía la forma correcta.
    const r = await pedir(`?tipo=TEST-ICAL-${sufijo}`, '00000000-0000-4000-8000-000000000000')
    expect(r.status).toBe(404)
  })

  it('un token que ni siquiera es un uuid da 404 sin tocar la base', async () => {
    const r = await pedir(`?tipo=TEST-ICAL-${sufijo}`, 'no-es-un-uuid')
    expect(r.status).toBe(404)
  })

  it('sin decir qué calendario se pide, explica cómo pedirlo', async () => {
    const r = await pedir('')
    expect(r.status).toBe(400)
    expect(await r.text()).toContain('?tipo=')
  })

  it('un tipo que no existe da 404', async () => {
    const r = await pedir('?tipo=NO-EXISTE-ESTE-TIPO')
    expect(r.status).toBe(404)
  })
})
