import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'
import { guardarResenas } from '@/lib/canales/resenas-servicio'
import { interpretarCsvResenas, type ResenaEntrante } from '@/lib/canales/resenas-csv'
import { huellaResena } from '@/lib/domain/resenas-canal'

/**
 * Ingesta de reseñas contra Postgres.
 *
 * Lo que sólo se puede verificar con la base: la idempotencia en sus **dos** piezas.
 * Las reseñas que traen `external_id` van por un unique parcial; las que no, por
 * `huella`. Hacen falta las dos, porque un `unique` sobre columna nullable **no impide
 * duplicados** —en Postgres cada `null` es distinto de todos los demás— y ése es
 * exactamente el caso que se da: el export no siempre trae identificador.
 */

const sufijo = sufijoUnico()
const AUTOR = `Resena${sufijo}`

function resena(over: Partial<ResenaEntrante> = {}): ResenaEntrante {
  return {
    externalId: `REV-${sufijo}-1`,
    reservaExternalId: null,
    autor: AUTOR,
    pais: 'AR',
    puntaje: 8.5,
    titulo: 'Muy bien',
    positivo: 'La vista',
    negativo: 'El wifi',
    publicadaEn: '2027-05-20',
    respuesta: '',
    huella: 'no-se-usa-porque-hay-id',
    ...over,
  }
}

describe.skipIf(!hayDB)('ingesta de reseñas', () => {
  let db: SupabaseClient

  const contexto = { canal: 'booking' as const, origen: `test-resenas-${sufijo}` }

  async function cuantas(): Promise<number> {
    const { count } = await db
      .from('canal_resenas')
      .select('*', { count: 'exact', head: true })
      .like('autor', `%${sufijo}%`)
    return count ?? 0
  }

  beforeAll(() => {
    db = clienteDePrueba()
  })

  afterAll(async () => {
    // Las reseñas primero: `reserva_id` es `on delete set null`, pero borrar antes la
    // reserva dejaría la reseña apuntando a nada y el sufijo es lo único que las
    // identifica.
    await db.from('canal_resenas').delete().like('autor', `%${sufijo}%`)

    // La reserva y el huésped que crea el test del vínculo manual. En orden: la
    // reserva tiene FK `on delete restrict` contra el huésped.
    const { data: huespedes } = await db
      .from('huespedes')
      .select('id')
      .like('apellido', `ResenaVinculo${sufijo}%`)

    for (const h of (huespedes ?? []) as { id: string }[]) {
      await db.from('reservas').delete().eq('huesped_id', h.id)
      await db.from('huespedes').delete().eq('id', h.id)
    }
  })

  it('guarda una reseña con identificador, con las columnas que antes no se escribían', async () => {
    const r = await guardarResenas(db, [resena()], contexto)

    expect(r.nuevas).toBe(1)
    expect(await cuantas()).toBe(1)

    const { data } = await db
      .from('canal_resenas')
      .select('pais, titulo, puntaje, huella, vinculo')
      .eq('external_id', `REV-${sufijo}-1`)
      .single()

    const f = data as {
      pais: string
      titulo: string
      puntaje: number
      huella: string | null
      vinculo: string
    }

    // Estas cuatro columnas existían y NUNCA se llenaban.
    expect(f.pais).toBe('AR')
    expect(f.titulo).toBe('Muy bien')
    expect(Number(f.puntaje)).toBe(8.5)
    // Con `external_id` la huella queda nula: las dos reglas de unicidad no se pisan.
    expect(f.huella).toBeNull()
    // Sin candidatas no se liga, y eso es lo correcto.
    expect(f.vinculo).toBe('sin_vincular')
  })

  it('reimportar la misma CON identificador no duplica', async () => {
    const r = await guardarResenas(db, [resena()], contexto)
    expect(r.nuevas).toBe(0)
    expect(r.actualizadas).toBe(1)
    expect(await cuantas()).toBe(1)
  })

  it('EL CASO CLAVE: reimportar una SIN identificador tampoco duplica', async () => {
    // Un unique sobre columna nullable no lo evita: diez reseñas sin id entrarían diez
    // veces sin que la restricción diga nada. La huella es lo que lo cubre.
    const autor = `${AUTOR}Bis`
    const sinId = resena({
      externalId: null,
      autor,
      positivo: 'Limpio',
      negativo: '',
      publicadaEn: '2027-05-21',
      huella: huellaResena({
        autor,
        publicadaEn: '2027-05-21',
        positivo: 'Limpio',
        negativo: '',
      }),
    })

    await guardarResenas(db, [sinId], contexto)
    await guardarResenas(db, [sinId], contexto)
    await guardarResenas(db, [sinId], contexto)

    const { count } = await db
      .from('canal_resenas')
      .select('*', { count: 'exact', head: true })
      .eq('autor', autor)

    expect(count, 'la huella no evitó el duplicado').toBe(1)
  })

  it('NO pisa la respuesta escrita en el panel con un export que la trae vacía', async () => {
    // El export del extranet puede no reflejar todavía la respuesta que el hotel
    // escribió desde el panel. Pisarla con vacío perdería el texto.
    const escrita = 'Gracias por avisar del wifi, ya lo cambiamos.'
    await db
      .from('canal_resenas')
      .update({ respuesta: escrita, respondida: true })
      .eq('external_id', `REV-${sufijo}-1`)

    await guardarResenas(db, [resena({ respuesta: '' })], contexto)

    const { data } = await db
      .from('canal_resenas')
      .select('respuesta, respondida')
      .eq('external_id', `REV-${sufijo}-1`)
      .single()

    const f = data as { respuesta: string; respondida: boolean }
    expect(f.respuesta, 'el export vacío borró la respuesta del hotel').toBe(escrita)
    expect(f.respondida).toBe(true)
  })

  it('NO pisa un vínculo hecho a mano, pero SÍ actualiza el contenido', async () => {
    // Si alguien ya decidió a qué reserva pertenece, la heurística no tiene autoridad
    // para cambiarlo: reimportar borraría el trabajo de esa persona.

    /*
      La reserva se CREA acá en vez de tomar una cualquiera con
      `from('reservas').limit(1).single()`.

      Esa versión pasaba en local —donde el seed y los datos de demo dejan reservas— y
      reventaba en CI con «Cannot read properties of null», porque ahí la tabla arranca
      vacía. Es el mismo error que ya se cometió dos veces en esta suite: depender de
      datos que el test no creó. Un test tiene que traer lo que necesita.
    */
    const { data: huesped, error: eHuesped } = await db
      .from('huespedes')
      .insert({ nombre: 'Titular', apellido: `ResenaVinculo${sufijo}` })
      .select('id')
      .single<{ id: string }>()
    if (eHuesped) throw new Error(`No se pudo crear el huésped: ${eHuesped.message}`)

    const { data: creada, error: eReserva } = await db
      .from('reservas')
      .insert({ huesped_id: huesped.id, estado: 'checkout', total: 100 })
      .select('id')
      .single<{ id: string }>()
    if (eReserva) throw new Error(`No se pudo crear la reserva: ${eReserva.message}`)

    const reservaId = creada.id

    await db
      .from('canal_resenas')
      .update({ reserva_id: reservaId, vinculo: 'manual' })
      .eq('external_id', `REV-${sufijo}-1`)

    await guardarResenas(db, [resena({ puntaje: 9 })], contexto)

    const { data } = await db
      .from('canal_resenas')
      .select('reserva_id, vinculo, puntaje')
      .eq('external_id', `REV-${sufijo}-1`)
      .single()

    const f = data as { reserva_id: string; vinculo: string; puntaje: number }
    expect(f.reserva_id, 'la reimportación borró el vínculo manual').toBe(reservaId)
    expect(f.vinculo).toBe('manual')
    // El contenido sí se actualiza: el puntaje nuevo entró.
    expect(Number(f.puntaje)).toBe(9)
  })

  it('el lector rechaza las filas inservibles y dice cuál era cada una', () => {
    const csv = [
      'Autor;Puntaje;Lo positivo;Fecha de la resena',
      ';8;Todo bien;20/05/2027',
      'Nadie;;;20/05/2027',
      'Ana;9;La vista;20/05/2027',
    ].join('\n')

    const r = interpretarCsvResenas(csv)
    expect(r.resenas).toHaveLength(1)
    expect(r.rechazadas).toHaveLength(2)
    // El número de fila es el que se ve al abrir el archivo en Excel.
    expect(r.rechazadas[0].fila).toBe(2)
    expect(r.rechazadas[1].motivos.join(' ')).toContain('ni puntaje ni comentario')
  })

  it('el puntaje fuera de rango queda nulo, NO en cero', () => {
    // Un cero es un puntaje real y pésimo: confundirlo con «no informó» arruinaría el
    // promedio del hotel.
    const csv = ['Autor;Puntaje;Lo positivo', 'Ana;99;Algo', 'Luis;0;Nada'].join('\n')
    const r = interpretarCsvResenas(csv)

    expect(r.resenas[0].puntaje).toBeNull()
    expect(r.resenas[1].puntaje).toBe(0)
  })
})
