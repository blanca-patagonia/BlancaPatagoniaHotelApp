import { describe, it, expect, afterAll } from 'vitest'
import { clienteDePrueba, hayDB, sufijoUnico } from './db'

/**
 * El corte silencioso de PostgREST en 1000 filas.
 *
 * ── Por qué este test existe ────────────────────────────────────────────────
 *
 * `max_rows = 1000` (`supabase/config.toml:10`) recorta cualquier respuesta que
 * pase ese límite, y lo hace **con HTTP 200, sin error y sin nada en el cuerpo
 * que lo indique**. Solo la cabecera `Content-Range: 0-999/*` lo delata, y nadie
 * la mira.
 *
 * Tres pantallas contaban filas trayéndolas: mantenimiento, objetos perdidos y el
 * portal del socio. A partir de la fila 1001 el número que mostraban era
 * equivocado y nada fallaba. En el portal era peor que un número feo: el mapa de
 * tokens quedaba incompleto y a algunos socios les desaparecía el botón de
 * firmar.
 *
 * El arreglo es contar en la base (`count: 'exact', head: true`) o acotar la
 * consulta. Este test fija las dos mitades: que la trampa **existe** —para que
 * nadie la dé por superada— y que el camino correcto no cae en ella.
 *
 * Es el único test de la suite que siembra más de mil filas. Se hace con un solo
 * `insert` en lote y se limpia al final; tarda ~1 s.
 */
describe.skipIf(!hayDB)('el corte en 1000 filas de PostgREST', () => {
  const admin = clienteDePrueba()
  const marca = `TRUNC-${sufijoUnico()}`
  const CUANTAS = 1100

  afterAll(async () => {
    await admin.from('objetos_perdidos').delete().like('descripcion', `${marca}%`)
  })

  it('traer filas para contarlas da un número EQUIVOCADO, y sin avisar', async () => {
    const filas = Array.from({ length: CUANTAS }, (_, i) => ({
      descripcion: `${marca}-${i}`,
      ubicacion: 'depósito',
      fecha_hallazgo: '2026-01-01',
      estado: 'guardado' as const,
    }))
    const { error } = await admin.from('objetos_perdidos').insert(filas)
    expect(error, `no se pudieron sembrar las ${CUANTAS} filas`).toBeNull()

    // Exactamente lo que hacían las pantallas: traer y contar en JavaScript.
    const { data, error: eLectura } = await admin
      .from('objetos_perdidos')
      .select('estado')
      .like('descripcion', `${marca}%`)

    // Lo importante: NO hay error. La consulta «salió bien».
    expect(eLectura).toBeNull()
    expect(
      (data ?? []).length,
      'si esto deja de dar 1000, cambió `max_rows` y hay que revisar el resto del comentario',
    ).toBe(1000)

    // Y el conteo en JavaScript sobre eso habría dicho 1000 habiendo 1100.
    expect((data ?? []).length).toBeLessThan(CUANTAS)
  })

  it('contar en la base da el número REAL a cualquier volumen', async () => {
    // El arreglo. `head: true` además no transfiere ni una fila.
    const { count, error } = await admin
      .from('objetos_perdidos')
      .select('*', { count: 'exact', head: true })
      .like('descripcion', `${marca}%`)
      .eq('estado', 'guardado')

    expect(error).toBeNull()
    expect(count, 'el conteo exacto tiene que ver las 1100').toBe(CUANTAS)
  })

  it('acotar la consulta también evita el corte', async () => {
    // La otra salida, la que se usó en el portal del socio: en vez de traer la
    // tabla entera y filtrar en memoria, se le pide a la base solo lo que hace
    // falta. Acá se piden 10 de las 1100.
    const { data, error } = await admin
      .from('objetos_perdidos')
      .select('descripcion')
      .like('descripcion', `${marca}-1_`)
      .limit(10)

    expect(error).toBeNull()
    expect((data ?? []).length).toBe(10)
  })
})
