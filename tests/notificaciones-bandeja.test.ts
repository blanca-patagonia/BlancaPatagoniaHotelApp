import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, clienteAnonimo, hayAnon, sufijoUnico } from './db'
import { encolar, despachar } from '@/lib/notificaciones'
import { MAX_INTENTOS } from '@/lib/domain/notificaciones'

/**
 * La bandeja de salida contra la base (migración 0075).
 *
 * ── Qué se verifica acá y no en el test de dominio ──────────────────────────
 *
 * Las tres promesas que hacen que valga la pena separar encolar de enviar, y que
 * sólo se pueden comprobar con Postgres:
 *
 *  1. **Idempotencia**: encolar dos veces el mismo aviso deja UNA fila. Es lo que
 *     evita que reprocesar un webhook le mande dos confirmaciones al huésped.
 *  2. **Reintentos**: un envío fallido no se pierde — queda pendiente, con la
 *     espera corrida y el motivo escrito.
 *  3. **Consentimiento**: a quien pidió no recibir avisos no se le encola nada.
 *
 * El proveedor de correo es `consola`, que no manda nada y devuelve `ok`. Para
 * forzar el camino de fallo se usa un destinatario sin `@`, que es lo único que
 * ese proveedor rechaza.
 */

const VARIABLES = {
  nombre: 'Ana',
  codigo: 'BP-TEST',
  check_in: '10/03/2027',
  check_out: '13/03/2027',
  hora_check_in: '15:00',
  hora_check_out: '10:00',
  total: 'USD 300',
  enlace: 'https://h.local/x',
}

describe.skipIf(!hayDB)('bandeja de salida', () => {
  let db: SupabaseClient
  const sufijo = sufijoUnico()
  let huespedId = ''
  let huespedMudo = ''

  beforeAll(async () => {
    db = clienteDePrueba()

    const { data: h } = await db
      .from('huespedes')
      .insert({ apellido: `Aviso-${sufijo}`, nombre: 'Ana', email: `aviso-${sufijo}@example.com` })
      .select('id')
      .single()
    huespedId = (h as { id: string }).id

    const { data: m } = await db
      .from('huespedes')
      .insert({
        apellido: `Mudo-${sufijo}`,
        nombre: 'Beto',
        email: `mudo-${sufijo}@example.com`,
        acepta_avisos: false,
      })
      .select('id')
      .single()
    huespedMudo = (m as { id: string }).id
  }, 60_000)

  afterAll(async () => {
    await db.from('notificaciones').delete().like('clave', `%${sufijo}%`)
    for (const id of [huespedId, huespedMudo]) {
      if (id) await db.from('huespedes').delete().eq('id', id)
    }
  })

  async function filaDe(clave: string) {
    const { data } = await db
      .from('notificaciones')
      .select('id, estado, intentos, error, proximo_en, enviada_en')
      .eq('clave', clave)
      .maybeSingle()
    return data as {
      id: string
      estado: string
      intentos: number
      error: string | null
      proximo_en: string
      enviada_en: string | null
    } | null
  }

  it('encolar dos veces el mismo aviso deja una sola fila', async () => {
    const entidad = `r-${sufijo}-uno`

    const a = await encolar(db, {
      evento: 'confirmacion_reserva',
      entidadId: entidad,
      destinatario: `aviso-${sufijo}@example.com`,
      variables: VARIABLES,
    })
    const b = await encolar(db, {
      evento: 'confirmacion_reserva',
      entidadId: entidad,
      destinatario: `aviso-${sufijo}@example.com`,
      variables: VARIABLES,
    })

    expect(a.ok).toBe(true)
    expect(a.yaEstaba).toBeUndefined()
    // El segundo no es un error: es la idempotencia haciendo su trabajo.
    expect(b.ok, 'el segundo encolado se trató como fallo').toBe(true)
    expect(b.yaEstaba, 'no detectó que ya estaba encolada').toBe(true)

    const { count } = await db
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('clave', `confirmacion_reserva:${entidad}`)
    expect(count, 'el huésped iba a recibir dos confirmaciones').toBe(1)
  })

  it('a quien pidió no recibir avisos no se le encola nada', async () => {
    const r = await encolar(db, {
      evento: 'confirmacion_reserva',
      entidadId: `r-${sufijo}-mudo`,
      destinatario: `mudo-${sufijo}@example.com`,
      huespedId: huespedMudo,
      variables: VARIABLES,
    })

    expect(r.ok, 'se le escribió a quien pidió que no').toBe(false)
    expect(r.motivo).toContain('no recibir')
    expect(await filaDe(`confirmacion_reserva:r-${sufijo}-mudo`)).toBeNull()
  })

  it('sin email no se encola', async () => {
    const r = await encolar(db, {
      evento: 'confirmacion_reserva',
      entidadId: `r-${sufijo}-sinmail`,
      destinatario: null,
      variables: VARIABLES,
    })
    expect(r.ok).toBe(false)
  })

  it('despachar manda lo pendiente y lo marca enviado', async () => {
    const clave = `confirmacion_reserva:r-${sufijo}-uno`

    const resumen = await despachar(db, 50)
    expect(resumen.tomadas).toBeGreaterThan(0)

    const fila = await filaDe(clave)
    expect(fila?.estado, 'quedó pendiente después de despachar').toBe('enviada')
    expect(fila?.enviada_en, 'no quedó la marca de cuándo salió').not.toBeNull()
  })

  /*
    El camino que antes no existía: un envío que falla no se pierde. Con
    `enviarPlantilla` directo el resultado se descartaba en el call site y el
    correo desaparecía sin rastro ni reintento.
  */
  it('un envío fallido queda pendiente, con el motivo y la espera corrida', async () => {
    const entidad = `r-${sufijo}-falla`
    // Sin `@`: es lo único que el proveedor `consola` rechaza.
    await encolar(db, {
      evento: 'confirmacion_reserva',
      entidadId: entidad,
      destinatario: 'destinatario-sin-arroba',
      variables: VARIABLES,
    })

    const antes = new Date().toISOString()
    await despachar(db, 50)

    const fila = await filaDe(`confirmacion_reserva:${entidad}`)
    expect(fila?.estado, 'se dio por enviada una que falló').toBe('pendiente')
    expect(fila?.intentos).toBe(1)
    expect(fila?.error, 'no quedó el motivo del fallo').toBeTruthy()
    expect(
      fila!.proximo_en > antes,
      'no corrió el próximo intento: el cron la tomaría en bucle',
    ).toBe(true)
  })

  it('se rinde después de agotar los intentos', async () => {
    const entidad = `r-${sufijo}-rendida`
    await encolar(db, {
      evento: 'confirmacion_reserva',
      entidadId: entidad,
      destinatario: 'otro-sin-arroba',
      variables: VARIABLES,
    })

    const clave = `confirmacion_reserva:${entidad}`
    // Se la deja al borde y vencida, para no tener que esperar las esperas.
    await db
      .from('notificaciones')
      .update({ intentos: MAX_INTENTOS - 1, proximo_en: new Date(Date.now() - 1000).toISOString() })
      .eq('clave', clave)

    await despachar(db, 50)

    const fila = await filaDe(clave)
    expect(fila?.estado, 'siguió reintentando para siempre').toBe('fallida')
    expect(fila?.intentos).toBe(MAX_INTENTOS)
  })

  /**
   * El corte lo pone la BASE, no el proceso.
   *
   * Con `new Date().toISOString()` el corte dependía del reloj de la aplicación,
   * y app y Postgres corren en máquinas distintas: bastaba que la base fuera unos
   * segundos adelantada para que una fila recién encolada quedara por encima del
   * corte y **no se despachara**, sin que nada fallara.
   *
   * Apareció como un fallo intermitente de este mismo archivo, con el contenedor
   * local adelantado respecto del host. Acá se fuerza el caso: `proximo_en` se
   * escribe con el `now()` de la base, que es el instante más nuevo posible.
   */
  it('despacha una fila sellada con el reloj de la base, no el de la app', async () => {
    const entidad = `r-${sufijo}-reloj`
    await encolar(db, {
      evento: 'confirmacion_reserva',
      entidadId: entidad,
      destinatario: `aviso-${sufijo}@example.com`,
      variables: VARIABLES,
    })

    const clave = `confirmacion_reserva:${entidad}`
    // Se corre el turno medio segundo hacia adelante y se espera a que pase: es
    // el borde exacto donde un desfasaje de relojes decide si la fila se ve o no.
    const { error } = await db
      .from('notificaciones')
      .update({ proximo_en: new Date(Date.now() + 500).toISOString() })
      .eq('clave', clave)
    expect(error).toBeNull()

    await new Promise((r) => setTimeout(r, 900))
    await despachar(db, 50)

    expect((await filaDe(clave))?.estado, 'la fila recién encolada no se despachó').toBe('enviada')
  })

  it('no toca lo que todavía no le tocó el turno', async () => {
    const entidad = `r-${sufijo}-futura`
    await encolar(db, {
      evento: 'confirmacion_reserva',
      entidadId: entidad,
      destinatario: `aviso-${sufijo}@example.com`,
      variables: VARIABLES,
    })

    const clave = `confirmacion_reserva:${entidad}`
    const futuro = new Date(Date.now() + 3600_000).toISOString()
    await db.from('notificaciones').update({ proximo_en: futuro }).eq('clave', clave)

    await despachar(db, 50)

    const fila = await filaDe(clave)
    expect(fila?.estado, 'se adelantó a la hora prevista').toBe('pendiente')
    expect(fila?.intentos).toBe(0)
  })
})

describe.skipIf(!hayAnon)('borde público de la bandeja', () => {
  it('anon no lee las notificaciones', async () => {
    // Llevan el email del huésped y el enlace con su token.
    const { data, error } = await clienteAnonimo().from('notificaciones').select('id').limit(1)
    expect(data ?? [], 'anon leyó la bandeja').toHaveLength(0)
    if (error) expect(['42501', '42P01']).toContain(error.code)
  })
})
