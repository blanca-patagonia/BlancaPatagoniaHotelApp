import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico, periodo } from './db'
import { SELECT_RESERVAS } from '@/app/panel/reservas/consulta'
import { definicionDe, type VistaReservas } from '@/lib/domain/vistas-reservas'

/**
 * Test de integración de las vistas operativas del listado.
 *
 * ── Por qué hace falta base real ────────────────────────────────────────────
 *
 * `tests/vistas-reservas.test.ts` prueba las **definiciones** sin base: qué
 * estados entran en cada vista. Lo que ese test no puede ver es si la traducción
 * a filtros de PostgREST realmente filtra, y ahí está el riesgo:
 *
 * · `estadias.check_in` son las columnas **generadas** de la migración 0037. Si la
 *   expresión estuviera mal, devolverían la fecha equivocada sin ningún error.
 * · Los filtros sobre una tabla embebida (`estadias.check_in`) sólo acotan la
 *   fila madre si el embed es `!inner`. Con un embed normal, PostgREST devuelve
 *   **todas** las reservas con el array de estadías vacío — o sea, un filtro que
 *   no filtra nada y no falla.
 *
 * Esa segunda es la trampa: el resultado es plausible y silencioso. Por eso se
 * verifica contra Postgres, con datos armados a propósito.
 *
 * Se replica la traducción de `consultaReservas` en `aplicar()` porque la función
 * real recibe un cliente con la sesión del staff y acá se usa `service_role`.
 * `SELECT_RESERVAS` sí se importa del módulo real: si alguien le saca el
 * `!inner`, este test lo detecta.
 */

const sufijo = sufijoUnico()

/** Fechas fijas: no se usa «hoy» real para que el test no dependa del día. */
const HOY = '2026-11-10'
const AYER = '2026-11-09'
const MANANA = '2026-11-11'

describe.skipIf(!hayDB)('vistas operativas del listado de reservas', () => {
  let db: SupabaseClient
  const ids: Record<string, string> = {}
  const reservas: Record<string, string> = {}

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: tipo } = await db
      .from('tipos_unidad')
      .insert({
        codigo: `TEST-VI-${sufijo}`,
        nombre: 'Test vistas',
        categoria: 'hosteria',
        capacidad_max: 4,
      })
      .select('id')
      .single()
    ids.tipo = tipo!.id

    // Una unidad por escenario: la restricción de exclusión (ADR 0002) impide
    // solapar estadías activas sobre la misma unidad, y varios casos comparten
    // fechas.
    for (const n of ['llega', 'sale', 'encasa', 'grupo', 'particular', 'cancel']) {
      const { data: u } = await db
        .from('unidades')
        .insert({ tipo_unidad_id: ids.tipo, nombre: `Test vista ${n} ${sufijo}` })
        .select('id')
        .single()
      ids[`u_${n}`] = u!.id
    }

    const { data: huesped } = await db
      .from('huespedes')
      .insert({ nombre: 'Test', apellido: `Vistas ${sufijo}` })
      .select('id')
      .single()
    ids.huesped = huesped!.id

    const { data: agencia } = await db
      .from('agencias')
      .insert({ nombre: `Test agencia ${sufijo}` })
      .select('id')
      .single()
    ids.agencia = agencia!.id

    /** Crea reserva + estadía y guarda el id por clave. */
    async function crear(
      clave: string,
      unidad: string,
      estado: string,
      desde: string,
      hasta: string,
      extra: Record<string, unknown> = {},
    ) {
      const { data: r, error: eR } = await db
        .from('reservas')
        .insert({ huesped_id: ids.huesped, estado, notas: `test-vistas-${sufijo}`, ...extra })
        .select('id')
        .single()
      if (eR) throw new Error(`No se pudo crear la reserva ${clave}: ${eR.message}`)
      reservas[clave] = r!.id

      const { error: eE } = await db.from('estadias').insert({
        reserva_id: r!.id,
        unidad_id: unidad,
        tipo_unidad_id: ids.tipo,
        periodo: periodo(desde, hasta),
        estado,
        huespedes: 2,
      })
      if (eE) throw new Error(`No se pudo crear la estadía ${clave}: ${eE.message}`)
    }

    // Llega hoy, todavía sin registrar.
    await crear('llegaHoy', ids.u_llega, 'confirmada', HOY, '2026-11-14')
    // Sale hoy: entró antes y su check-out es hoy.
    await crear('saleHoy', ids.u_sale, 'in_house', '2026-11-07', HOY)
    // En el hotel: registrado, y su salida NO es hoy.
    await crear('enCasa', ids.u_encasa, 'in_house', AYER, '2026-11-15')
    // Cancelada que llegaba hoy: no tiene que aparecer en las llegadas.
    await crear('canceladaHoy', ids.u_cancel, 'cancelada', HOY, MANANA)
    // Grupal.
    await crear('grupal', ids.u_grupo, 'confirmada', '2026-12-01', '2026-12-03', {
      grupo_id: crypto.randomUUID(),
    })
    // Con agencia: NO es particular.
    await crear('conAgencia', ids.u_particular, 'confirmada', '2026-12-05', '2026-12-07', {
      agencia_id: ids.agencia,
    })
  })

  afterAll(async () => {
    for (const id of Object.values(reservas)) await db.from('reservas').delete().eq('id', id)
    for (const [k, v] of Object.entries(ids)) {
      if (k.startsWith('u_')) await db.from('unidades').delete().eq('id', v)
    }
    if (ids.agencia) await db.from('agencias').delete().eq('id', ids.agencia)
    if (ids.tipo) await db.from('tipos_unidad').delete().eq('id', ids.tipo)
    if (ids.huesped) await db.from('huespedes').delete().eq('id', ids.huesped)
  })

  /**
   * Aplica una vista y devuelve los códigos de reserva que salen.
   *
   * Se acota a los datos de esta corrida por `notas` para que la base sembrada no
   * ensucie el resultado.
   */
  async function aplicar(vista: VistaReservas): Promise<string[]> {
    const d = definicionDe(vista)
    let q = db.from('reservas').select(SELECT_RESERVAS).eq('notas', `test-vistas-${sufijo}`)

    if (d.estados) q = q.in('estado', [...d.estados])
    if (d.fecha) {
      q = q.eq(d.fecha === 'llega' ? 'estadias.check_in' : 'estadias.check_out', HOY)
    }
    if (d.agrupacion === 'grupo') q = q.not('grupo_id', 'is', null)
    if (d.agrupacion === 'particular') q = q.is('grupo_id', null).is('agencia_id', null)

    const { data, error } = await q
    if (error) throw new Error(`La consulta de «${vista}» falló: ${error.message}`)
    return (data ?? []).map((r) => (r as { id: string }).id)
  }

  it('las columnas generadas de la 0037 coinciden con el período', async () => {
    // Si la expresión `lower(periodo)` estuviera mal, devolverían una fecha
    // equivocada sin dar ningún error.
    const { data } = await db
      .from('estadias')
      .select('periodo, check_in, check_out')
      .eq('reserva_id', reservas.llegaHoy)
      .single()

    expect(data!.check_in).toBe(HOY)
    expect(data!.check_out).toBe('2026-11-14')
    expect(data!.periodo).toContain(HOY)
  })

  it('una columna generada no se puede escribir', async () => {
    // Es la garantía de que no puede desincronizarse de `periodo`.
    const { error } = await db
      .from('estadias')
      .update({ check_in: '2020-01-01' })
      .eq('reserva_id', reservas.llegaHoy)

    expect(error).not.toBeNull()
  })

  it('«Llegadas hoy» trae la que entra hoy', async () => {
    const ids = await aplicar('llegadas')
    expect(ids).toContain(reservas.llegaHoy)
  })

  it('«Llegadas hoy» NO trae la cancelada que llegaba hoy', async () => {
    // Mostrarla obligaría a leer la columna de estado para saber a quién esperar.
    const ids = await aplicar('llegadas')
    expect(ids).not.toContain(reservas.canceladaHoy)
  })

  it('«Llegadas hoy» NO trae a quien entró ayer', async () => {
    // ESTE es el test que detecta el embed sin `!inner`: sin él, PostgREST
    // devolvería todas las reservas y el filtro no filtraría nada, en silencio.
    const ids = await aplicar('llegadas')
    expect(ids).not.toContain(reservas.enCasa)
  })

  it('«Salidas hoy» trae la que sale hoy y no la que sale la semana que viene', async () => {
    const ids = await aplicar('salidas')
    expect(ids).toContain(reservas.saleHoy)
    expect(ids).not.toContain(reservas.enCasa)
  })

  it('la noche del check-out no confunde llegadas con salidas', async () => {
    // `saleHoy` tiene check_out = HOY; no puede aparecer como llegada de hoy.
    const llegadas = await aplicar('llegadas')
    expect(llegadas).not.toContain(reservas.saleHoy)
  })

  it('«En el hotel» trae los registrados, sin importar la fecha', async () => {
    const ids = await aplicar('en_casa')
    expect(ids).toContain(reservas.enCasa)
    expect(ids).toContain(reservas.saleHoy) // también está in_house
    expect(ids).not.toContain(reservas.llegaHoy) // confirmada, no registrada
  })

  it('«Grupos» trae solo las que tienen grupo', async () => {
    const ids = await aplicar('grupos')
    expect(ids).toEqual([reservas.grupal])
  })

  it('«Particulares» excluye las de agencia', async () => {
    // Quien vino por agencia no es particular aunque haya venido solo.
    const ids = await aplicar('particulares')
    expect(ids).not.toContain(reservas.conAgencia)
    expect(ids).not.toContain(reservas.grupal)
    expect(ids).toContain(reservas.llegaHoy)
  })

  it('«Canceladas» trae la cancelada', async () => {
    const ids = await aplicar('canceladas')
    expect(ids).toEqual([reservas.canceladaHoy])
  })

  it('el select trae los pagos para poder calcular el saldo', async () => {
    // Sin esto la columna de saldo mostraría el total como si nada estuviera pago.
    const { data, error } = await db
      .from('reservas')
      .select(SELECT_RESERVAS)
      .eq('id', reservas.llegaHoy)
      .single()

    expect(error).toBeNull()
    expect(data).toHaveProperty('pagos')
    expect(Array.isArray((data as { pagos: unknown[] }).pagos)).toBe(true)
  })
})
