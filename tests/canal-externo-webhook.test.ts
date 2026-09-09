import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from './db'
import { nuevoContexto, limpiar, type Contexto } from './acciones/entorno'

/*
  `permitirIntento` llama a `headers()` de `next/headers`, que solo existe
  dentro de una petición real de Next — llamar al handler directo desde un test
  no la provee. Mismo mock que usa `tests/webhook-pagos.test.ts` para el mismo
  motivo: acá no se está probando el limitador, se prueba el webhook.
*/
vi.mock('@/lib/limites', () => ({ permitirIntento: async () => true }))

const { POST } = await import('@/app/api/canales/externos/[token]/route')

/**
 * Webhook receptor de un channel manager externo (Fase 7 del análisis de
 * referencia). Va contra la base real, no mockeada: el punto central a probar
 * —que descuenta inventario de verdad y respeta el anti-overbooking— no se
 * puede demostrar con un cliente falso sin reimplementar la restricción de
 * exclusión GiST en el mock (ver el mismo argumento en
 * `tests/acciones/reservas.test.ts`).
 */
describe.skipIf(!hayDB)('Webhook · canal externo', () => {
  let ctx: Contexto
  let canalId: string
  let token: string
  let codigo: string
  let tipoId: string
  let desde: string
  let hasta: string

  async function fechasConTarifa(): Promise<{ desde: string; hasta: string }> {
    const { data } = await ctx.db.from('temporada_rangos').select('rango').limit(1).single()
    const rango = (data as { rango: string }).rango
    const d0 = rango.slice(1, 11)
    const d = new Date(`${d0}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return { desde: d0, hasta: d.toISOString().slice(0, 10) }
  }

  function llamar(cuerpo: unknown, tok = token) {
    return POST(
      new Request(`http://local/api/canales/externos/${tok}`, {
        method: 'POST',
        body: JSON.stringify(cuerpo),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ token: tok }) },
    )
  }

  beforeAll(async () => {
    ctx = nuevoContexto()
    codigo = `test-cm-${ctx.sufijo}`
    ;({ desde, hasta } = await fechasConTarifa())

    const { data: canal } = await ctx.db
      .from('canales_externos')
      .insert({ codigo, nombre: `Canal de prueba ${ctx.sufijo}` })
      .select('id, token')
      .single<{ id: string; token: string }>()
    canalId = canal!.id
    token = canal!.token
    // El borrado de `canales_externos` arrastra su mapeo por `on delete cascade`.
    ctx.aBorrar.push({ tabla: 'canales_externos', id: canalId })

    const { data: tipo } = await ctx.db.from('tipos_unidad').select('id').limit(1).single<{ id: string }>()
    tipoId = tipo!.id

    await ctx.db.from('canal_externo_tipos').insert({
      canal_externo_id: canalId,
      tipo_unidad_id: tipoId,
      codigo_externo: 'HAB-TEST',
    })
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  it('token que no existe da 404, no 401', async () => {
    const r = await llamar(
      { codigo_habitacion: 'X', check_in: desde, check_out: hasta, huesped: { apellido: 'X' }, adultos: 1, referencia_externa: 'x' },
      '00000000-0000-0000-0000-000000000000',
    )
    expect(r.status).toBe(404)
  })

  it('rechaza un cuerpo sin referencia_externa', async () => {
    const r = await llamar({
      codigo_habitacion: 'HAB-TEST',
      check_in: desde,
      check_out: hasta,
      huesped: { apellido: 'Sin Referencia' },
      adultos: 1,
    })
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toMatch(/referencia_externa/)
  })

  it('un código de habitación sin mapear da 400 y dice cuál falta', async () => {
    const r = await llamar({
      codigo_habitacion: 'CODIGO-INEXISTENTE',
      check_in: desde,
      check_out: hasta,
      huesped: { apellido: 'Sin Mapeo' },
      adultos: 1,
      referencia_externa: `ref-${ctx.sufijo}-mapeo`,
    })
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toMatch(/CODIGO-INEXISTENTE/)
  })

  it('crea la reserva de verdad, con el canal y el voucher correctos', async () => {
    const r = await llamar({
      codigo_habitacion: 'HAB-TEST',
      check_in: desde,
      check_out: hasta,
      huesped: { apellido: `Externo-${ctx.sufijo}`, email: `externo-${ctx.sufijo}@ejemplo.com` },
      adultos: 2,
      referencia_externa: `ref-${ctx.sufijo}-1`,
    })
    expect(r.status, `esperaba 201, la respuesta fue: ${JSON.stringify(await r.clone().json())}`).toBe(201)
    const body = await r.json()
    ctx.aBorrar.push({ tabla: 'reservas', id: body.reserva_id })

    const { data: reserva } = await ctx.db
      .from('reservas')
      .select('huesped_id, canal, voucher, tarifa_tipo, estado')
      .eq('id', body.reserva_id)
      .single<{ huesped_id: string; canal: string; voucher: string; tarifa_tipo: string; estado: string }>()
    ctx.aBorrar.push({ tabla: 'huespedes', id: reserva!.huesped_id })

    // `reservas.canal` es el bucket genérico, no el proveedor puntual (0093):
    // eso viaja en el prefijo del voucher.
    expect(reserva!.canal).toBe('channel_manager')
    expect(reserva!.voucher).toBe(`${codigo}:ref-${ctx.sufijo}-1`)
    expect(reserva!.tarifa_tipo).toBe('neto')
    expect(reserva!.estado).toBe('confirmada')
  })

  it('un reintento con la misma referencia_externa NO duplica la reserva', async () => {
    const primera = await llamar({
      codigo_habitacion: 'HAB-TEST',
      check_in: desde,
      check_out: hasta,
      huesped: { apellido: `Reintento-${ctx.sufijo}`, email: `reintento-${ctx.sufijo}@ejemplo.com` },
      adultos: 1,
      referencia_externa: `ref-${ctx.sufijo}-reintento`,
    })
    expect(primera.status).toBe(201)
    const bodyPrimera = await primera.json()
    ctx.aBorrar.push({ tabla: 'reservas', id: bodyPrimera.reserva_id })
    const { data: r1 } = await ctx.db
      .from('reservas')
      .select('huesped_id')
      .eq('id', bodyPrimera.reserva_id)
      .single<{ huesped_id: string }>()
    ctx.aBorrar.push({ tabla: 'huespedes', id: r1!.huesped_id })

    // Mismo huésped y misma referencia: si esto creara una segunda reserva, el
    // channel manager pensaría que vendió dos veces lo que vendió una.
    const segunda = await llamar({
      codigo_habitacion: 'HAB-TEST',
      check_in: desde,
      check_out: hasta,
      huesped: { apellido: `Reintento-${ctx.sufijo}`, email: `reintento-${ctx.sufijo}@ejemplo.com` },
      adultos: 1,
      referencia_externa: `ref-${ctx.sufijo}-reintento`,
    })
    expect(segunda.status).toBe(200)
    const bodySegunda = await segunda.json()
    expect(bodySegunda.duplicado).toBe(true)
    expect(bodySegunda.reserva_id).toBe(bodyPrimera.reserva_id)
  })
})
