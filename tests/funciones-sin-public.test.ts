import { describe, it, expect } from 'vitest'
import { clienteDePrueba, clienteAnonimo, hayDB, hayAnon } from './db'

/**
 * Contrato: ninguna función propia nace ejecutable por PUBLIC sin quererlo.
 *
 * `cotizar_estadia` estuvo cuatro auditorías con el EXECUTE a PUBLIC intacto
 * —Postgres se lo concede a toda función nueva— mientras el ADR 0016 y
 * `CLAUDE.md` daban por hecho que la migración 0031 lo había cerrado. No lo había
 * cerrado: la 0031 revocó de `anon`, que nunca tuvo un grant propio que quitar.
 *
 * Este test evita que vuelva a pasar. `funciones_expuestas_a_publico()`
 * (migración 0070) lista las funciones propias —descartando las de la extensión
 * `btree_gist` y las de trigger— que PUBLIC puede ejecutar. La allowlist de abajo
 * es la única lista de tres que debería devolver. Una función nueva sin su
 * `revoke execute ... from public` hace fallar este test.
 */

/**
 * Las tres funciones que SÍ tienen que ser ejecutables por PUBLIC:
 *  · `rol_actual` y `puede_ver_canal` aparecen en expresiones de políticas RLS, y
 *    Postgres chequea el EXECUTE del rol que consulta al evaluar una policy.
 *  · `temporada_en` la llama `cotizar_estadia_publica` en modo `security invoker`,
 *    así que corre con el rol de quien cotiza —`anon` desde el portal—.
 */
const PERMITIDAS = [
  'puede_ver_canal(p_canal uuid)',
  'rol_actual()',
  'temporada_en(f date)',
]

describe.skipIf(!hayDB)('funciones sin grant a PUBLIC', () => {
  it('solo las tres funciones de la allowlist quedan expuestas a PUBLIC', async () => {
    const { data, error } = await clienteDePrueba().rpc('funciones_expuestas_a_publico')
    expect(error, error?.message).toBeNull()

    const expuestas = ((data ?? []) as { firma: string }[]).map((f) => f.firma).sort()
    const sobrantes = expuestas.filter((f) => !PERMITIDAS.includes(f))

    expect(
      sobrantes,
      'función(es) propias ejecutables por PUBLIC sin estar en la allowlist: ' +
        'agregá `revoke execute ... from public` en su migración, o sumala a PERMITIDAS ' +
        'si de verdad tiene que ser pública (y explicá por qué).',
    ).toEqual([])
  })
})

describe.skipIf(!hayAnon)('borde público: las funciones sensibles ya no se alcanzan', () => {
  it('anon no puede ejecutar cotizar_estadia (la que conoce el neto)', async () => {
    const { error } = await clienteAnonimo().rpc('cotizar_estadia', {
      p_tipo_unidad_id: '00000000-0000-0000-0000-000000000000',
      p_check_in: '2026-01-01',
      p_check_out: '2026-01-02',
      p_tarifa_tipo: 'neto',
    })
    // 42501 = insufficient_privilege sobre la función. Es más fuerte que fallar
    // adentro por la tabla: no la alcanza siquiera.
    expect(error?.code, 'anon pudo ejecutar cotizar_estadia').toBe('42501')
  })

  it('anon no puede ejecutar siguiente_numero_comprobante (el contador fiscal)', async () => {
    const { error } = await clienteAnonimo().rpc('siguiente_numero_comprobante', {
      p_punto_venta: 1,
    })
    expect(error?.code, 'anon pudo mover el contador de facturas').toBe('42501')
  })

  it('anon SÍ puede ejecutar cotizar_estadia_publica: el portal depende de eso', async () => {
    const { error } = await clienteAnonimo().rpc('cotizar_estadia_publica', {
      p_tipo_unidad_id: '00000000-0000-0000-0000-000000000000',
      p_check_in: '2026-01-01',
      p_check_out: '2026-01-02',
    })
    // Sin filas (uuid inexistente) pero sin error de permiso: la función se alcanza.
    expect(error).toBeNull()
  })

  it('anon ya no tiene SELECT de tabla sobre agencias / proveedores / firmas', async () => {
    for (const tabla of ['agencias', 'proveedores', 'firmas'] as const) {
      const { error } = await clienteAnonimo().from(tabla).select('token').limit(1)
      expect(error?.code, `anon pudo pedir ${tabla}.token`).toBe('42501')
    }
  })

  it('anon recibe permiso denegado —no filas vacías— sobre las tablas con datos personales', async () => {
    // Migración 0072: `anon` pierde el SELECT de tabla fuera del catálogo. Antes
    // RLS devolvía 0 filas (una capa); ahora PostgREST corta con 42501 antes de
    // evaluar la política. La diferencia importa: no hay que razonar sobre las
    // políticas en el caso `anon` si `anon` no llega a ellas.
    for (const tabla of ['reservas', 'huespedes', 'pagos', 'facturas', 'perfiles', 'auditoria'] as const) {
      const { error } = await clienteAnonimo().from(tabla).select('id').limit(1)
      expect(error?.code, `anon todavía alcanza ${tabla}`).toBe('42501')
    }
  })

  it('anon SÍ sigue leyendo el catálogo público: la web sin sesión depende de eso', async () => {
    const { data, error } = await clienteAnonimo().from('tipos_unidad').select('id').limit(1)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })
})
