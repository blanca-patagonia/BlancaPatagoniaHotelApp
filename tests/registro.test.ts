import { describe, it, expect, afterAll } from 'vitest'
import { guardarError } from '@/lib/registro'
import { clienteDePrueba, clienteAnonimo, hayDB, hayAnon, sufijoUnico } from './db'

/**
 * El sink de `lib/registro.ts` contra la tabla `errores` (migración 0068).
 *
 * Lo que se verifica acá no es que se escriba una fila —eso es lo fácil— sino
 * las tres promesas que hacen que valga la pena tenerlo:
 *
 *  1. El dato sensible **no llega** a la tabla, aunque alguien lo pase.
 *  2. El sink **nunca lanza**, ni con la base caída. Un logger que rompe la
 *     petición que estaba registrando es peor que no tener logger.
 *  3. `anon` **no lee** la tabla. Un error arrastra rutas, ids y a veces el dato
 *     que lo causó.
 */

const ctx = { aBorrar: [] as string[] }

afterAll(async () => {
  if (!hayDB || ctx.aBorrar.length === 0) return
  await clienteDePrueba().from('errores').delete().in('id', ctx.aBorrar)
})

describe.skipIf(!hayDB)('sink de errores', () => {
  it('guarda el evento con su contexto', async () => {
    const evento = `prueba_sink_${sufijoUnico()}`

    await guardarError('error', evento, { detalle: 'algo se rompió' }, {
      pedido: 'iad1::abc123',
      digest: '1234567890',
      ruta: '/panel/reservas/[id]',
    })

    const { data } = await clienteDePrueba()
      .from('errores')
      .select('id, evento, nivel, detalle, pedido, digest, ruta, datos')
      .eq('evento', evento)
      .single()

    expect(data, 'el sink no escribió la fila').not.toBeNull()
    ctx.aBorrar.push(data!.id)

    expect(data!.nivel).toBe('error')
    expect(data!.detalle).toBe('algo se rompió')
    expect(data!.pedido).toBe('iad1::abc123')
    // El digest es el hilo entre lo que vio el usuario y el stack del servidor.
    expect(data!.digest).toBe('1234567890')
    expect(data!.ruta).toBe('/panel/reservas/[id]')
  })

  it('no deja pasar datos sensibles, ni por nombre de campo ni por contenido', async () => {
    const evento = `prueba_secreto_${sufijoUnico()}`

    await guardarError('error', evento, {
      // Por nombre: alguien pasa `token` sin pensarlo.
      token: 'sbp_0123456789abcdef',
      // Por contenido: el mensaje de la base arrastra algo que parece una
      // tarjeta. Es la capa que salva cuando el dato viene en texto libre.
      detalle: 'falló al procesar 4111111111111111 en el cobro',
    })

    const { data } = await clienteDePrueba()
      .from('errores')
      .select('id, detalle, datos')
      .eq('evento', evento)
      .single()

    ctx.aBorrar.push(data!.id)

    const datos = data!.datos as Record<string, unknown>
    expect(datos.token, 'el token llegó a la base en claro').toBe('[oculto]')
    expect(data!.detalle).not.toContain('4111111111111111')
    expect(data!.detalle).toContain('[oculto]')
  })

  it('con la base inalcanzable no lanza: se traga el fallo y sigue', async () => {
    const urlOriginal = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1/no-existe'

    try {
      // Si esto lanzara, rompería la petición que estaba registrando el error,
      // que es exactamente lo que el sink no puede hacer.
      await expect(
        guardarError('error', `prueba_caida_${sufijoUnico()}`, { detalle: 'x' }),
      ).resolves.toBeUndefined()
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = urlOriginal
    }
  })
})

describe.skipIf(!hayAnon)('borde público de `errores`', () => {
  it('anon no lee la tabla', async () => {
    const { data, error } = await clienteAnonimo().from('errores').select('id').limit(1)

    // Puede negar por GRANT (42501) o devolver vacío por RLS. Las dos son
    // aceptables; lo que no es aceptable es que devuelva filas.
    expect(data ?? [], 'anon leyó errores del servidor').toHaveLength(0)
    if (error) expect(['42501', '42P01']).toContain(error.code)
  })

  it('anon no puede insertar para ensuciar el rastro', async () => {
    const { error } = await clienteAnonimo()
      .from('errores')
      .insert({ evento: 'inyectado_por_anon', detalle: 'no debería entrar' })

    expect(error, 'anon pudo escribir en errores').not.toBeNull()
  })
})
